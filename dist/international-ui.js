const fieldIds={recipient:'customer-recipient',phone:'customer-phone',countryCode:'customer-country',province:'customer-province',city:'customer-city',district:'customer-district',addressLine:'customer-address-line',postalCode:'customer-postal-code'};
const autoComplete={recipient:'shipping name',phone:'shipping tel',countryCode:'shipping country',province:'shipping address-level1',city:'shipping address-level2',district:'shipping address-level3',addressLine:'shipping address-line1',postalCode:'shipping postal-code'};
const fieldLimits={recipient:80,phone:40,province:80,city:80,district:80,addressLine:240,postalCode:20};
// Keep the mainland choice list and accepted short names aligned with customer.mjs.
const mainlandProvinces=['北京市','天津市','河北省','山西省','内蒙古自治区','辽宁省','吉林省','黑龙江省','上海市','江苏省','浙江省','安徽省','福建省','江西省','山东省','河南省','湖北省','湖南省','广东省','广西壮族自治区','海南省','重庆市','四川省','贵州省','云南省','西藏自治区','陕西省','甘肃省','青海省','宁夏回族自治区','新疆维吾尔自治区'];
const mainlandProvinceAliases=new Map(mainlandProvinces.flatMap(province=>[[province,province],[province.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/,''),province]]));

export function createInternationalUI({get,escape:esc}) {
  let configuration=null,loading=null;
  async function load(){
    if(configuration)return configuration;
    if(loading)return loading;
    loading=get('/markets').then(result=>{if(!Array.isArray(result.markets)||!result.markets.length)throw new Error('地区配置暂不可用，请重试。');configuration=result;return result;}).finally(()=>{loading=null;});
    return loading;
  }
  function marketFor(country='CN'){
    return configuration?.markets.find(m=>m.countryCode===country)||configuration?.markets.find(m=>m.countryCode==='OTHER')||null;
  }
  function options(selected){return (configuration?.markets||[]).map(m=>'<option value="'+esc(m.countryCode)+'" '+(m.countryCode===selected?'selected':'')+'>'+esc(m.name)+(m.nameEn?' · '+esc(m.nameEn):'')+'</option>').join('');}
  function provinceOptions(value=''){
    const previous=String(value).trim(),selected=mainlandProvinceAliases.get(previous)||previous;
    return '<option value="" '+(!selected?'selected':'')+'>请选择省 / 直辖市 / 自治区</option>'+
      (selected&&!mainlandProvinceAliases.has(selected)?'<option value="'+esc(previous)+'" selected>'+esc(previous)+'（请重新选择）</option>':'')+
      mainlandProvinces.map(province=>'<option value="'+esc(province)+'" '+(province===selected?'selected':'')+'>'+esc(province)+'</option>').join('');
  }
  function paymentHTML(country,{compact=false}={}){
    const market=marketFor(country);if(!market)return '<p>地区支付方案正在加载。</p>';
    return '<div class="market-payment '+(compact?'compact':'')+'"><div class="market-payment-heading"><strong>'+esc(market.name)+' · 支付方案</strong><span>尚未开通</span></div><p class="market-currency">当地参考币种 '+esc(market.referenceCurrency||'待确认')+' · 当前沙盒统一以 CNY 计价，无汇率换算</p><div class="'+(compact?'payment-method-chips':'payment-method-plans')+'">'+market.payment.methods.map(method=>compact?'<span>'+esc(method.label)+'</span>':'<div><strong>'+esc(method.label)+'</strong><span>待开通 · 不可付款</span></div>').join('')+'</div><p class="market-payment-note">'+esc(market.payment.note||'支付方式还取决于商家所在地、币种、设备与支付服务商审核。')+'</p></div>';
  }
  function fieldsHTML(address={}){
    const requested=address.countryCode||'CN',market=marketFor(requested);if(!market)return '<p role="alert">地区配置加载失败，请重新打开资料。</p>';
    const selected=market.countryCode,fields=market.address.fields;
    return '<div class="customer-form-grid">'+market.address.fieldOrder.filter(key=>fields[key]?.visible).map(key=>{
      const field=fields[key],id=fieldIds[key];if(!id)return '';
      const label=field.label+(field.required||/选填|如适用/.test(field.label)?'':'（选填）'),attrs=' id="'+id+'" name="'+id+'" autocomplete="'+autoComplete[key]+'" '+(field.required?'required':'');
      let control;
      if(key==='countryCode')control='<select class="select"'+attrs+'>'+options(selected)+'</select>';
      else if(key==='province'&&selected==='CN')control='<select class="select"'+attrs+'>'+provinceOptions(address.province)+'</select>';
      else control='<input class="input"'+attrs+' type="'+(key==='phone'?'tel':'text')+'" maxlength="'+fieldLimits[key]+'" value="'+esc(address[key]||'')+'" placeholder="'+esc(field.placeholder||'')+'"/>';
      return '<div class="field '+(key==='addressLine'?'field-wide':'')+'"><label class="field-label" for="'+id+'">'+esc(label)+'</label>'+control+(key==='phone'?'<small class="field-help">国家 / 地区区号 '+esc(market.phonePrefix||'请填写国际区号')+'；切换地区不会修改你的电话号码。</small>':'')+(key==='countryCode'&&selected==='OTHER'?'<label class="field-label other-country-label" for="customer-country-code">国家 / 地区代码</label><input class="input" id="customer-country-code" maxlength="2" pattern="[A-Za-z]{2}" required value="'+esc(/^[A-Z]{2}$/.test(requested)?requested:'')+'" placeholder="两位字母，如 IT"/>':'')+'</div>';
    }).join('')+'</div><p class="customer-privacy-note">'+esc(market.address.note||'请按收件地的格式填写地址。')+'</p><div id="customer-payment-preview">'+paymentHTML(selected,{compact:true})+'</div>';
  }
  function readAddress(root=document){
    const value=id=>root.querySelector('#'+id)?.value.trim()||'';
    const selected=value('customer-country'),countryCode=(selected==='OTHER'?value('customer-country-code'):selected).toUpperCase();
    return {...Object.fromEntries(Object.entries(fieldIds).filter(([key])=>key!=='countryCode').map(([key,id])=>[key,value(id)])),countryCode};
  }
  function changeCountry(country,root=document){
    const container=root.querySelector('#customer-address-fields');if(!container)return;
    const previous=readAddress(root);
    // Regional names and postal codes cannot be silently carried into another country.
    container.innerHTML=fieldsHTML({...previous,countryCode:country,province:'',city:'',district:'',postalCode:''});
    root.querySelector('#customer-country')?.focus({preventScroll:true});
  }
  function validateAddressFields(address={}){
    const errors={},countryCode=typeof address.countryCode==='string'?address.countryCode.trim().toUpperCase():'';
    if(!/^[A-Z]{2}$/.test(countryCode))errors['customer-country-code']='请填写两位字母的国家 / 地区代码，例如 IT。';
    const market=marketFor(countryCode);
    if(!market){errors['customer-country']='地区配置暂不可用，请重新打开资料。';return errors;}
    for(const key of market.address.fieldOrder){
      const field=market.address.fields[key],id=fieldIds[key];
      if(!field?.visible||!id||key==='countryCode')continue;
      const raw=address[key],value=typeof raw==='string'?raw.trim():'';
      if(raw!=null&&typeof raw!=='string'){errors[id]='请填写有效的'+field.label+'。';continue;}
      if(field.required&&!value){errors[id]='请填写'+field.label+'。';continue;}
      if(value.length>fieldLimits[key]){errors[id]=field.label+'不能超过 '+fieldLimits[key]+' 个字符。';continue;}
      if(/[\u0000-\u001f\u007f]/.test(value)){errors[id]=field.label+'不能包含换行或控制字符。';continue;}
      if(key==='phone'&&value){
        const digits=value.replace(/\D/g,'').length;
        if(!/^[+0-9 ()-]+$/.test(value)||digits<5||digits>20||/\+/.test(value.slice(1)))errors[id]='联系电话需含 5–20 位数字；可使用空格、括号和短横线，+ 只能放在开头。';
      }
      if(key==='province'&&countryCode==='CN'&&value&&!mainlandProvinceAliases.has(value))errors[id]='请从列表选择有效的省 / 直辖市 / 自治区。';
    }
    return errors;
  }
  function validateAddress(address){return Object.values(validateAddressFields(address))[0]||'';}
  return {load,marketFor,options,paymentHTML,fieldsHTML,readAddress,changeCountry,validateAddress,validateAddressFields};
}
