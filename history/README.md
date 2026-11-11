# 原始 Git 历史

这里的 [Gongzao-Shared-3D.bundle](Gongzao-Shared-3D.bundle) 保存原始 main、13 个附注标签和它们指向的提交。可在仓库分支选择器中切换 release/vX.Y.Z，逐版比较代码，或阅读[中文版本日志](../CHANGELOG.md)。

原始 bundle SHA-256 为 `10b79f547c46aa69aaa5b86663bedb1f0837e785ad969648623094765d094c6e`。

在本仓库的本地克隆根目录，可将原始提交与标签还原到另一个目录。

```sh
git clone --branch main history/Gongzao-Shared-3D.bundle ../Gongzao-original
git -C ../Gongzao-original tag --list
git -C ../Gongzao-original log --oneline --decorate
```

## 恢复 v0.9.5

先用上方命令将基础历史包克隆到 `../Gongzao-original`。新增的 [v0.9.5.bundle](v0.9.5.bundle) 是增量包，依赖基础包中的 v0.9.4 原始提交 `ab5f1eba9392ef8795665cca06c7b260e306adb1`。以下命令从本仓库的克隆根目录运行。

```sh
git -C ../Gongzao-original bundle verify ../Gongzao-Shared-3D/history/v0.9.5.bundle
git -C ../Gongzao-original fetch ../Gongzao-Shared-3D/history/v0.9.5.bundle refs/tags/v0.9.5:refs/tags/v0.9.5
git -C ../Gongzao-original switch --detach v0.9.5
git -C ../Gongzao-original show --no-patch v0.9.5
```

上述相对路径假定本仓库的克隆目录名是 `Gongzao-Shared-3D`。目录名不同时，可在 `bundle verify` 和 `fetch` 两处改用增量包的绝对路径。

增量包 SHA-256 为 `782e3470804c1faf5c02a90869ce86c5a58d2911308ffb8821b9d8a78e543c5c`，原始附注标签对象为 `b510b25982808cb8569ed425932ad41d56e26d59`。GitHub 网页中可由 `release/v0.9.5` 分支查看此版源码。

下表保留原始提交及本次历史归档提交的对应关系。归档时逐版校验了完整的 Git 文件树。

| 版本 | 原始提交 | 在线归档提交 |
| --- | --- | --- |
| [v0.1.0](https://github.com/aHao030/Gongzao-Shared-3D/tree/release/v0.1.0) | `894c6aa4900027708b3e7d6ef5a81290fd2f9b6e` | [4c6875b98923](https://github.com/aHao030/Gongzao-Shared-3D/commit/4c6875b9892391a4107c7f3dc1a95c6d361570e1) |
| [v0.2.0](https://github.com/aHao030/Gongzao-Shared-3D/tree/release/v0.2.0) | `2da4cc622ea95379359365c04c3341ff2e6faab4` | [081b39b7876e](https://github.com/aHao030/Gongzao-Shared-3D/commit/081b39b7876e08f53e8801545dc82d39ca0da910) |
| [v0.3.0](https://github.com/aHao030/Gongzao-Shared-3D/tree/release/v0.3.0) | `c7cdcd13b8c2e489915321df508bf4d98a2344fc` | [e6522d854302](https://github.com/aHao030/Gongzao-Shared-3D/commit/e6522d85430234aa56627bbb2cc642b3f6511c27) |
| [v0.4.0](https://github.com/aHao030/Gongzao-Shared-3D/tree/release/v0.4.0) | `cbff9711e121360935938a7bfbaac27df0e6cdce` | [aa1b03b4f747](https://github.com/aHao030/Gongzao-Shared-3D/commit/aa1b03b4f74725cef69a57200b27863728c06e48) |
| [v0.5.0](https://github.com/aHao030/Gongzao-Shared-3D/tree/release/v0.5.0) | `9b1c7327a7a1b768639dc552742061641ef37f8e` | [0989b63d3cc5](https://github.com/aHao030/Gongzao-Shared-3D/commit/0989b63d3cc5781876fb3017f51714a95f4db50c) |
| [v0.6.0](https://github.com/aHao030/Gongzao-Shared-3D/tree/release/v0.6.0) | `c19eb4ea3de9d8ec0775ea691bae515f91e31cd5` | [4795d67835e6](https://github.com/aHao030/Gongzao-Shared-3D/commit/4795d67835e6a5dd5bc8f2fe072e1d4837b0a249) |
| [v0.7.0](https://github.com/aHao030/Gongzao-Shared-3D/tree/release/v0.7.0) | `e9eeae3f0b2f60fc1d88b8879213e79ce63b54a3` | [8ba40a101bdd](https://github.com/aHao030/Gongzao-Shared-3D/commit/8ba40a101bdddd87fc8b45787e86576a3cda0de4) |
| [v0.8.0](https://github.com/aHao030/Gongzao-Shared-3D/tree/release/v0.8.0) | `de7139685636e4f49a56a5d85c68f2e91e10f67e` | [74722fc92861](https://github.com/aHao030/Gongzao-Shared-3D/commit/74722fc928612803efefc80dde244f89e98c4d4d) |
| [v0.9.0](https://github.com/aHao030/Gongzao-Shared-3D/tree/release/v0.9.0) | `5b160291008f26dabbc5a3d512dd68a52a37ddc3` | [99a7c857de33](https://github.com/aHao030/Gongzao-Shared-3D/commit/99a7c857de331dec11619f31e64d0be5830489e4) |
| [v0.9.1](https://github.com/aHao030/Gongzao-Shared-3D/tree/release/v0.9.1) | `b8e4520f2afac96bcb477adbae5c8a7010dc47fe` | [e70367ea6853](https://github.com/aHao030/Gongzao-Shared-3D/commit/e70367ea68533876d161e25f27648f6879430429) |
| [v0.9.2](https://github.com/aHao030/Gongzao-Shared-3D/tree/release/v0.9.2) | `bf1a75aae519097cbb8c494ca25584bdd47ed137` | [505559520b85](https://github.com/aHao030/Gongzao-Shared-3D/commit/505559520b852b66ec3a52cf08e0cd160b9469ba) |
| [v0.9.3](https://github.com/aHao030/Gongzao-Shared-3D/tree/release/v0.9.3) | `5a58e71c82874fdc5935cfb52626375c147f0e78` | [b8422bec3000](https://github.com/aHao030/Gongzao-Shared-3D/commit/b8422bec30007ed539fda808a0201bbb2d0f9564) |
| [v0.9.4](https://github.com/aHao030/Gongzao-Shared-3D/tree/release/v0.9.4) | `ab5f1eba9392ef8795665cca06c7b260e306adb1` | [9daab63bb6d0](https://github.com/aHao030/Gongzao-Shared-3D/commit/9daab63bb6d072a9760552ff1ee22bee91cd2408) |
| [v0.9.5](https://github.com/aHao030/Gongzao-Shared-3D/tree/release/v0.9.5) | `3475523be0b7a6f7349728a4e25ad68ef5cf604f` | [2c64ca9d4ebb](https://github.com/aHao030/Gongzao-Shared-3D/commit/2c64ca9d4ebbf596030c17ff3b8a15ea12195507) |
