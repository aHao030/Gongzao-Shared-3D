// Field feedback is transient UI state. It never persists form values.
const feedback = new WeakMap();
const safeId = id => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id);
function control(form,id){return safeId(id)?form.querySelector('#'+id):null;}
function focusControl(node){node?.focus({preventScroll:true});node?.scrollIntoView?.({block:'center',behavior:'auto'});}
function describe(node,id,add){
  const ids=new Set((node.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));
  if(add)ids.add(id);else ids.delete(id);
  if(ids.size)node.setAttribute('aria-describedby',[...ids].join(' '));else node.removeAttribute('aria-describedby');
}
export function showFieldErrors(form,errors,{summaryId,focus=true,message=''}={}){
  if(!form)return false;
  const previous=feedback.get(form)||{errors:{},summaryId};
  for(const id of Object.keys(previous.errors)){
    const node=control(form,id);if(!node)continue;
    node.removeAttribute('aria-invalid');describe(node,id+'-error',false);
    const note=control(form,id+'-error');if(note){note.textContent='';note.hidden=true;}
  }
  const next={};
  for(const [id,text] of Object.entries(errors||{})){
    const node=control(form,id);if(!node||!text)continue;
    next[id]=String(text);node.setAttribute('aria-invalid','true');describe(node,id+'-error',true);
    let note=control(form,id+'-error');
    if(!note){note=form.ownerDocument.createElement('p');note.id=id+'-error';note.className='field-error';node.insertAdjacentElement('afterend',note);}
    note.textContent=next[id];note.hidden=false;
  }
  const resolvedSummary=summaryId||previous.summaryId;
  feedback.set(form,{errors:next,summaryId:resolvedSummary});
  const summary=resolvedSummary?control(form,resolvedSummary):null;
  if(summary){
    summary.replaceChildren();summary.hidden=!Object.keys(next).length&&!message;
    if(!summary.hidden){
      const heading=form.ownerDocument.createElement('p');heading.textContent=message||'还有 '+Object.keys(next).length+' 处需要修改：';summary.append(heading);
      if(Object.keys(next).length){const list=form.ownerDocument.createElement('ul');
        for(const [id,text] of Object.entries(next)){
          const row=form.ownerDocument.createElement('li'),button=form.ownerDocument.createElement('button');
          button.type='button';button.className='field-error-link';button.textContent=text;
          button.addEventListener('click',()=>focusControl(control(form,id)));row.append(button);list.append(row);
        }summary.append(list);
      }
    }
  }
  if(focus&&Object.keys(next).length)focusControl(form.querySelector('[aria-invalid="true"]'));
  else if(focus&&message&&summary){summary.tabIndex=-1;focusControl(summary);}
  return Object.keys(next).length>0;
}
export function updateFieldError(form,id,error,{summaryId}={}){
  const errors={...(feedback.get(form)?.errors||{})};
  if(error)errors[id]=error;else delete errors[id];
  return showFieldErrors(form,errors,{summaryId,focus:false});
}
export function hasFieldError(form,id){return !!feedback.get(form)?.errors[id];}
