#!/usr/bin/env python3
"""Bounded manufacturing computations. One JSON request on stdin, one JSON result.

This program never connects to printers. Only the local worker supplies paths and
allow-listed profiles. Model files are always converted to geometry-only STL
before slicing so a customer's 3MF cannot supply printer settings or scripts.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

SCHEMA = "gongzao-manufacturing-result-v1"
MAX_MODEL = 20 * 1024 * 1024
MAX_GCODE = 100 * 1024 * 1024
MAX_FACES = 500000


class TaskError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def require(condition, code, message):
    if not condition:
        raise TaskError(code, message)


def finite(value, low=0, high=1e12):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and low <= value <= high


def digest(data):
    return hashlib.sha256(data).hexdigest()


def version(name):
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def bounded_file(raw_path, root, maximum):
    require(isinstance(raw_path, str) and isinstance(root, str), "INVALID_PATH", "Local file root is required")
    base = Path(root).resolve(strict=True)
    candidate = Path(raw_path).resolve(strict=True)
    require(candidate.is_relative_to(base) and candidate.is_file(), "PATH_OUTSIDE_ROOT", "File must belong to this task directory")
    require(0 < candidate.stat().st_size <= maximum, "FILE_SIZE_LIMIT", "File exceeds the configured limit")
    return candidate, candidate.read_bytes()


def checked_model(request):
    path, data = bounded_file(request.get("modelPath"), request.get("jobDirectory"), MAX_MODEL)
    require(re.fullmatch(r"[a-f0-9]{64}", request.get("modelHash", "")) and digest(data) == request["modelHash"], "MODEL_HASH_MISMATCH", "Model bytes do not match the task snapshot")
    require(request.get("unit") in ("mm", "inch"), "INVALID_UNIT", "Explicit model units are required")
    require(isinstance(request.get("quantity", 1), int) and not isinstance(request.get("quantity", 1), bool) and 1 <= request.get("quantity", 1) <= 50, "INVALID_QUANTITY", "Quantity must be between 1 and 50")
    return path, data


def preflight_3mf(data):
    try:
        units = set()
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members = archive.infolist()
            require(len(members) <= 200 and sum(m.file_size for m in members) <= 100 * 1024 * 1024, "ARCHIVE_LIMIT", "3MF archive expands beyond the allowed limit")
            for member in members:
                require(member.file_size <= 50 * 1024 * 1024 and member.file_size <= max(member.compress_size, 1) * 200, "ARCHIVE_LIMIT", "3MF archive compression ratio exceeds the allowed limit")
                name = member.filename.replace("\\", "/")
                require(not name.startswith("/") and ".." not in name.split("/"), "INVALID_ARCHIVE_PATH", "3MF archive contains an unsafe path")
                if name.lower().endswith((".model", ".xml", ".rels")):
                    from defusedxml.ElementTree import fromstring
                    root = fromstring(archive.read(member))
                    if name.lower().endswith(".model"):
                        units.add(root.attrib.get("unit", "millimeter").lower())
        require(len(units) == 1, "MODEL_UNIT_MISMATCH", "3MF components must declare one consistent unit")
        return next(iter(units))
    except TaskError:
        raise
    except Exception as error:
        raise TaskError("INVALID_3MF", "3MF archive or XML is invalid") from error


def geometry(request):
    try:
        import numpy as np
        import trimesh
    except ImportError as error:
        raise TaskError("DEPENDENCY_UNAVAILABLE", "Install the pinned manufacturing Python dependencies") from error
    path, data = checked_model(request)
    fmt = request.get("format", path.suffix.lstrip(".")).lower()
    require(fmt in ("stl", "3mf"), "ENGINEERING_REVIEW_REQUIRED", "STEP and image files require an engineering review; this worker analyzes STL and 3MF geometry")
    if fmt == "3mf":
        embedded_unit = preflight_3mf(data)
        accepted = {"mm":{"mm", "millimeter", "millimeters"}, "inch":{"in", "inch", "inches"}}
        require(embedded_unit in accepted[request["unit"]], "MODEL_UNIT_MISMATCH", "Confirmed units differ from the embedded 3MF units; request an engineering review")
    try:
        mesh = trimesh.load_mesh(io.BytesIO(data), file_type=fmt, process=False, allow_remote=False)
        require(isinstance(mesh, trimesh.Trimesh), "INVALID_MESH", "The model does not contain a triangle mesh")
        require(0 < len(mesh.faces) <= MAX_FACES and len(mesh.vertices) <= MAX_FACES * 3, "MESH_COMPLEXITY_LIMIT", "The model exceeds the triangle limit")
        require(bool((mesh.faces >= 0).all()) and int(mesh.faces.max()) < len(mesh.vertices), "INVALID_FACE_INDEX", "The model contains an invalid triangle vertex reference")
        require(bool(np.isfinite(mesh.vertices).all()) and bool((np.abs(mesh.vertices) <= 1e6).all()), "INVALID_COORDINATE", "The model contains invalid or excessive coordinates")
        mesh.merge_vertices()  # Index STL triangle soup; do not fill holes or change winding.
        if request["unit"] == "inch":
            mesh.apply_scale(25.4)
        dims = [float(value) for value in mesh.extents]
        require(len(dims) == 3 and all(finite(value, 1e-9, 1e6) for value in dims), "INVALID_DIMENSIONS", "The model must have three finite positive dimensions")
        watertight, winding = bool(mesh.is_watertight), bool(mesh.is_winding_consistent)
        is_volume = bool(mesh.is_volume)
        degenerate = bool((mesh.area_faces <= 1e-12).any())
        # Dependency-free connectivity count, including multi-body STL inputs.
        parent = list(range(len(mesh.vertices)))
        def find(index):
            while parent[index] != index:
                parent[index] = parent[parent[index]]
                index = parent[index]
            return index
        for triangle in mesh.faces:
            first = find(int(triangle[0]))
            for index in triangle[1:]:
                parent[find(int(index))] = first
        body_count = len({find(int(index)) for index in mesh.faces.reshape(-1)})
        warnings = []
        if not watertight:
            warnings.append("OPEN_MESH")
        if not winding:
            warnings.append("INCONSISTENT_WINDING")
        if not is_volume:
            warnings.append("INVALID_SOLID_VOLUME")
        if degenerate:
            warnings.append("DEGENERATE_FACES")
        result = {
            "dimensionsMm": dims, "volumeMm3": float(mesh.volume) if is_volume else None,
            "surfaceAreaMm2": float(mesh.area), "watertight": watertight,
            "windingConsistent": winding, "isVolume": is_volume,
            "bodyCount": body_count, "faceCount": len(mesh.faces),
            "requiresReview": bool(warnings), "warnings": warnings,
            "scope": "Geometry checks only; wall thickness, strength, supports and machine clearance are not certified",
        }
        return mesh, result
    except TaskError:
        raise
    except Exception as error:
        raise TaskError("MODEL_PARSE_FAILED", "Model geometry could not be safely analyzed") from error


def base_result(request, name, engine_version):
    return {
        "schemaVersion": SCHEMA, "provenance": "WORKER_OBSERVED",
        "inputHash": request.get("inputHash"), "modelHash": request.get("modelHash"),
        "profileRevision": request.get("profileRevision"),
        "quantity": request.get("quantity", 1), "unit": request.get("unit", "mm"),
        "engine": {"name": name, "version": engine_version},
        "engineVersion": engine_version, "printReady": False,
    }


def parse_gcode_metadata(text):
    time_match = re.search(r"^;\s*estimated printing time \(normal mode\)\s*=\s*(.+)$", text, re.M)
    require(time_match is not None, "SLICER_METADATA_MISSING", "Normal-mode printing time is missing from the slicer output")
    value = time_match.group(1).strip()
    parts = re.findall(r"(\d+(?:\.\d+)?)\s*([dhms])", value)
    require(parts and not re.sub(r"\d+(?:\.\d+)?\s*[dhms]|\s+", "", value), "SLICER_METADATA_INVALID", "Printing time has an unsupported format")
    duration = sum(float(number) * {"d":86400,"h":3600,"m":60,"s":1}[unit] for number, unit in parts)
    weight_match = re.search(r"^;\s*(?:total )?filament used \[g\]\s*=\s*(.+)$", text, re.M)
    require(weight_match is not None, "SLICER_METADATA_MISSING", "Filament weight is missing from the slicer output")
    parts = weight_match.group(1).split(",")
    require(1 <= len(parts) <= 16 and all(re.fullmatch(r"\s*\d+(?:\.\d+)?\s*", value) for value in parts), "SLICER_METADATA_INVALID", "Filament weight has an unsupported format")
    weight = sum(float(value) for value in parts)
    require(finite(duration, 1, 365 * 86400) and finite(weight, 0.0001, 1e6), "SLICER_METADATA_INVALID", "Slicer estimates are outside the allowed range")
    return {"durationSeconds": math.ceil(duration), "materialGrams": round(weight, 4)}


def validate_profile(request):
    profile, data = bounded_file(request.get("profilePath"), request.get("profileDirectory"), 1024 * 1024)
    actual_hash = digest(data)
    require(actual_hash == request.get("profileSha256"), "PROFILE_HASH_MISMATCH", "The local profile changed after it was configured")
    expected = request.get("expectedProfileSha256")
    require(not expected or expected == actual_hash, "PROFILE_HASH_MISMATCH", "Profile bytes do not match the merchant task snapshot")
    try:
        content = data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise TaskError("INVALID_PROFILE", "The profile must be UTF-8 INI") from error
    for line in content.splitlines():
        if re.match(r"^\s*post_process\s*=", line, re.I):
            value = line.split("=", 1)[1].strip()
            require(value in ("", '""'), "POST_PROCESS_FORBIDDEN", "Slicer post-processing scripts are forbidden")
    return profile, actual_hash


def child_limits(timeout):
    """POSIX defense in depth; Docker supplies limits on other platforms."""
    if os.name != "posix":
        return None
    def apply():
        import resource
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_GCODE + 1024 * 1024, MAX_GCODE + 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (math.ceil(timeout) + 5, math.ceil(timeout) + 5))
        resource.setrlimit(resource.RLIMIT_AS, (3 * 1024**3, 3 * 1024**3))
    return apply


def slice_model(request):
    mesh, shape = geometry(request)
    require(not shape["requiresReview"], "MODEL_REVIEW_REQUIRED", "The model must pass geometry review before automatic slicing")
    profile, profile_hash = validate_profile(request)
    executable = request.get("prusaSlicerExecutable", "prusa-slicer")
    require(isinstance(executable, str) and executable and "\x00" not in executable, "INVALID_SLICER", "A local PrusaSlicer executable is required")
    resolved = shutil.which(executable)
    require(resolved, "SLICER_UNAVAILABLE", "PrusaSlicer is not installed or is not on PATH")
    timeout = request.get("timeoutSeconds", 180)
    require(finite(timeout, 10, 600), "INVALID_TIMEOUT", "Slicer timeout must be between 10 and 600 seconds")
    try:
        # PrusaSlicer 2.x exposes its version in --help, not --version.
        info = subprocess.run([resolved, "--help"], capture_output=True, text=True, timeout=10, check=True)
        match = re.search(r"PrusaSlicer[- ]([^\s]+)", info.stdout + info.stderr)
        require(match is not None, "UNSUPPORTED_SLICER", "This adapter requires PrusaSlicer")
        engine_version = ("PrusaSlicer-" + match.group(1))[:100]
        output_dir = Path(request["jobDirectory"]).resolve(strict=True)
        normalized = output_dir / "normalized.stl"
        output = output_dir / "toolpath.gcode"
        # Never pass the customer 3MF to PrusaSlicer: retain geometry only.
        normalized.write_bytes(mesh.export(file_type="stl"))
        command = [resolved, "--datadir", str(output_dir / "settings"), "--config-compatibility", "disable", "--threads", "2", "--load", str(profile), "--export-gcode", "--duplicate", str(request.get("quantity", 1)), "--output", str(output), str(normalized)]
        with tempfile.TemporaryFile() as log:
            process = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=log, stderr=log, cwd=output_dir, timeout=timeout, check=False, preexec_fn=child_limits(timeout), env={**os.environ, "HOME":str(output_dir), "LC_ALL":"C.UTF-8"})
            require(process.returncode == 0, "SLICER_FAILED", "PrusaSlicer rejected this model or profile")
        _, data = bounded_file(str(output), str(output_dir), MAX_GCODE)
        # The footer contains metadata; cap parser memory even for a large G-code file.
        metadata = parse_gcode_metadata(data[-1024 * 1024:].decode("utf-8", errors="replace"))
        return {**base_result(request, "PrusaSlicer", engine_version), **metadata,
                "geometry":shape, "profileSha256":profile_hash,
                "artifactHash":digest(data), "artifactBytes":len(data),
                "artifactFile":"toolpath.gcode", "geometryEngineVersion":version("trimesh"),
                "requiresReview": True,
                "reviewReason":"Slicing estimates are not machine/fixture clearance or physical quality certification"}
    except subprocess.TimeoutExpired as error:
        raise TaskError("SLICER_TIMEOUT", "PrusaSlicer exceeded the task time limit") from error
    except subprocess.CalledProcessError as error:
        raise TaskError("SLICER_UNAVAILABLE", "PrusaSlicer could not report its version") from error


def schedule(request):
    try:
        from ortools.sat.python import cp_model
    except ImportError as error:
        raise TaskError("DEPENDENCY_UNAVAILABLE", "Install the pinned OR-Tools dependency") from error
    snapshot = request.get("scheduleSnapshot") or request.get("configSnapshot") or {}
    tasks, base_at = snapshot.get("tasks"), snapshot.get("baseAt")
    require(isinstance(tasks, list) and 0 <= len(tasks) <= 200 and finite(base_at, 0, 8640000000000000), "INVALID_SCHEDULE", "A bounded server-owned schedule snapshot is required")
    if not tasks:
        return {**base_result(request, "OR-Tools CP-SAT", version("ortools")), "solverStatus":"EMPTY", "schedule":[]}
    seen = set()
    for task in tasks:
        require(isinstance(task, dict) and isinstance(task.get("jobId"), str) and 0 < len(task["jobId"]) <= 160 and task["jobId"] not in seen and isinstance(task.get("deviceId"), str) and 0 < len(task["deviceId"]) <= 160 and finite(task.get("durationSeconds"), 1, 30 * 86400), "INVALID_SCHEDULE", "Tasks must have unique IDs, devices and positive durations")
        seen.add(task["jobId"])
    model = cp_model.CpModel()
    horizon = sum(math.ceil(task["durationSeconds"]) for task in tasks)
    intervals, variables = {}, []
    for index, task in enumerate(tasks):
        duration = math.ceil(task["durationSeconds"])
        start, end = model.new_int_var(0, horizon, f"s{index}"), model.new_int_var(0, horizon, f"e{index}")
        interval = model.new_interval_var(start, duration, end, f"i{index}")
        intervals.setdefault(task["deviceId"], []).append(interval)
        variables.append((task, start, end))
    for group in intervals.values():
        model.add_no_overlap(group)
    makespan = model.new_int_var(0, horizon, "makespan")
    model.add_max_equality(makespan, [end for _, _, end in variables])
    # A single bounded objective avoids overflowing CP-SAT's signed 64-bit domain.
    # A deterministic single-threaded solver is used; no deadlines are invented.
    model.minimize(makespan)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0
    status = solver.solve(model)
    require(status in (cp_model.OPTIMAL, cp_model.FEASIBLE), "SCHEDULE_UNAVAILABLE", "No feasible schedule was found within the time limit")
    return {**base_result(request, "OR-Tools CP-SAT", version("ortools")),
            "solverStatus":solver.status_name(status), "schedule":[{"jobId":task["jobId"], "deviceId":task["deviceId"], "startAt":base_at + solver.value(start) * 1000, "endAt":base_at + solver.value(end) * 1000} for task, start, end in variables],
            "scope":"Advisory fixed-device non-overlapping schedule; staff, setup, shipping and maintenance constraints must be reviewed"}


def cnc_review(request):
    path, _ = checked_model(request)
    require(path.suffix.lower() in (".step", ".stp", ".stl"), "UNSUPPORTED_FORMAT", "CNC review accepts STEP or STL")
    return {**base_result(request, "CNC review package", "1"), "status":"ENGINEERING_REVIEW_REQUIRED", "automaticCam":False,
            "requiredChecks":["Drawing units and tolerances", "Stock material and dimensions", "Tool selection and holder clearance", "Fixtures and work coordinate system", "Cutting parameters and machining operations", "Machine-specific postprocessor", "Simulation and operator sign-off"],
            "recommendedTool":"FreeCAD CAM", "toolpathGenerated":False}


def execute(request):
    require(isinstance(request, dict), "INVALID_REQUEST", "The request must be an object")
    kind = request.get("kind")
    if kind == "STATUS":
        return {"schemaVersion":SCHEMA, "trimesh":version("trimesh"), "ortools":version("ortools"), "prusaSlicerAvailable":bool(shutil.which(request.get("prusaSlicerExecutable", "prusa-slicer"))), "automaticPrint":False, "automaticCam":False}
    require(re.fullmatch(r"[a-f0-9]{64}", request.get("inputHash", "")), "INVALID_INPUT_HASH", "The immutable job input hash is required")
    if kind == "ANALYZE_MODEL":
        _, shape = geometry(request)
        return {**base_result(request, "Trimesh", version("trimesh")), "geometry":shape}
    if kind == "SLICE_MODEL":
        return slice_model(request)
    if kind == "SCHEDULE":
        return schedule(request)
    if kind == "CNC_REVIEW":
        return cnc_review(request)
    raise TaskError("UNSUPPORTED_JOB", "The worker does not support this task kind")


def main():
    try:
        if os.name == "posix":
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (3 * 1024**3, 3 * 1024**3))
            resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_GCODE + 1024 * 1024, MAX_GCODE + 1024 * 1024))
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        require(len(raw) <= 1024 * 1024, "REQUEST_TOO_LARGE", "Worker input is too large")
        request = json.loads(raw)
        result = execute(request)
        print(json.dumps({"ok":True, "result":result}, allow_nan=False))
        return 0
    except TaskError as error:
        print(json.dumps({"ok":False, "error":{"code":error.code, "message":str(error)}}))
    except (ValueError, TypeError, FileNotFoundError, PermissionError, KeyError):
        print(json.dumps({"ok":False, "error":{"code":"INVALID_LOCAL_INPUT", "message":"Local task files or JSON input are invalid"}}))
    except Exception:
        print(json.dumps({"ok":False, "error":{"code":"ENGINE_FAILURE", "message":"The manufacturing computation failed; inspect local configuration"}}))
    return 1


if __name__ == "__main__":
    sys.exit(main())
