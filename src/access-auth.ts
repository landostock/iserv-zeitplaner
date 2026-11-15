import { createRemoteJWKSet, customFetch, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError, origin, sha256 } from './security.ts';
import type { Env } from './types.ts';

let cached:{issuer:string;keys:JWTVerifyGetKey}|undefined;
export async function accessIdentity(env:Env,request:Request,keys?:JWTVerifyGetKey){
  if(env.AUTH_MODE!=='access'||!env.ACCESS_ISSUER||!env.ACCESS_AUD||!env.ACCESS_EMAILS)throw new AppError('setup_required',503);
  const issuer=origin(env.ACCESS_ISSUER);
  if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(new URL(issuer).hostname))throw new AppError('setup_required',503);
  const token=request.headers.get('Cf-Access-Jwt-Assertion');
  if(!token||token.length>20000)throw new AppError('login_required',401);
  if(!keys){
    if(cached?.issuer!==issuer)cached={issuer,keys:createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs'),{[customFetch]:(input,init)=>fetch(input,{...init,redirect:'manual',signal:AbortSignal.timeout(10000)})})};
    keys=cached!.keys;
  }
  try{
    const {payload}=await jwtVerify(token,keys,{issuer,audience:env.ACCESS_AUD,algorithms:['RS256'],clockTolerance:5});
    if(!payload.exp||typeof payload.sub!=='string'||!payload.sub||typeof payload.email!=='string'||payload.type!=='app')throw new Error();
    const email=payload.email.toLowerCase();
    if(!env.ACCESS_EMAILS.split(',').map(x=>x.trim().toLowerCase()).includes(email))throw new AppError('account_not_allowed',403);
    return {subject:payload.sub,name:email,owner:sha256(issuer+':'+payload.sub)};
  }catch(error){if(error instanceof AppError)throw error;throw new AppError('login_required',401);}
}
