import {generateKeyPairSync,sign,randomBytes,createHash} from 'node:crypto';
import {encodeCBOR} from '@levischuck/tiny-cbor';
const digest=(v:Uint8Array|string)=>createHash('sha256').update(v).digest();
const b64=(v:Uint8Array)=>Buffer.from(v).toString('base64url');
/** Synthetic software authenticator; never used against a school or with an actual user's identity. */
export function syntheticAuthenticator(){
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),id=randomBytes(32),credentialId=b64(id);let handle='';
  const cose=encodeCBOR(new Map<number,any>([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x!,'base64url')],[-3,Buffer.from(jwk.y!,'base64url')]]));
  return {
    registration(options:any,origin:string,uv=true){
      handle=options.user.id;const clientData=new TextEncoder().encode(JSON.stringify({type:'webauthn.create',challenge:options.challenge,origin,crossOrigin:false}));
      const length=Buffer.alloc(2);length.writeUInt16BE(id.length);
      const authData=Buffer.concat([digest(options.rp.id),Buffer.from([uv?0x45:0x41]),Buffer.alloc(4),Buffer.alloc(16),length,id,cose]);
      const attestation=encodeCBOR(new Map<string,any>([['fmt','none'],['attStmt',new Map()],['authData',authData]]));
      return {id:credentialId,rawId:credentialId,type:'public-key',authenticatorAttachment:'platform',clientExtensionResults:{credProps:{rk:true}},response:{clientDataJSON:b64(clientData),attestationObject:b64(attestation),transports:['internal']}};
    },
    authentication(options:any,origin:string,counter=1,uv=true){
      const clientData=new TextEncoder().encode(JSON.stringify({type:'webauthn.get',challenge:options.challenge,origin,crossOrigin:false})),n=Buffer.alloc(4);n.writeUInt32BE(counter);
      const authData=Buffer.concat([digest(options.rpId),Buffer.from([uv?0x05:0x01]),n]);
      const signature=sign('sha256',Buffer.concat([authData,digest(clientData)]),privateKey);
      return {id:credentialId,rawId:credentialId,type:'public-key',authenticatorAttachment:'platform',clientExtensionResults:{},response:{clientDataJSON:b64(clientData),authenticatorData:b64(authData),signature:b64(signature),userHandle:handle}};
    }
  };
}
