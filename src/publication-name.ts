/** Fresh server-generated 128-bit nonce. Naming reduces accidental collisions; it is not a server-side lock. */
export function publicationNonce(){
  return Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
}
export function publicationName(original:string,nonce:string){
  if(!/^[a-f0-9]{32}$/.test(nonce)||!original||/[\\/\x00-\x1f\x7f]/.test(original))throw new Error('invalid_filename');
  const normalized=original.normalize('NFC'),dot=normalized.lastIndexOf('.');
  const extension=dot>0?normalized.slice(dot):'',suffix=' ['+nonce+']'+extension;
  const encoder=new TextEncoder();
  if(encoder.encode(suffix).length>=240||suffix.length>=180)throw new Error('invalid_filename');
  const chars=Array.from(dot>0?normalized.slice(0,dot):normalized);
  while(chars.length&&(encoder.encode(chars.join('')+suffix).length>240||(chars.join('')+suffix).length>180))chars.pop();
  const stem=chars.join('').trimEnd();if(!stem)throw new Error('invalid_filename');
  return stem+suffix;
}
export function uniqueTargetMatches(data:{filename:string;folder:string;target:string;targetNaming?:string;targetNonce?:string}){
  try{return data.targetNaming==='unique-v1'&&Boolean(data.targetNonce)&&data.target===data.folder+publicationName(data.filename,data.targetNonce!);}catch{return false;}
}
export const temporaryPublicationName=(nonce:string)=>{
  if(!/^[a-f0-9]{32}$/.test(nonce))throw new Error('invalid_filename');
  return 'zeitplaner-vorbereitung-'+nonce+'.tmp';
};
export function originalTargetMatches(data:{filename:string;folder:string;target:string;targetNaming?:string;targetNonce?:string;temporaryTarget?:string;originalMoveVerifiedAtPlan?:boolean}){
  try{return data.targetNaming==='original-move-v1'&&data.originalMoveVerifiedAtPlan===true&&Boolean(data.targetNonce)&&data.target===data.folder+data.filename&&data.temporaryTarget===data.folder+temporaryPublicationName(data.targetNonce!);}catch{return false;}
}
