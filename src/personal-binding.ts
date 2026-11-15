import {AppError} from './security.ts';
import type {Env} from './types.ts';
export function installation(env:Env){if(!env.INSTALLATION)throw new AppError('setup_required',503);const n=env.INSTALLATION.jurisdiction('eu');return n.get(n.idFromName('personal-installation-v1'));}
