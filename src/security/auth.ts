import { timingSafeEqual } from 'node:crypto';
export function equals(a:string,b:string) {
  const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y);
}
export function safeName(name:string) {
  if(!/^[\p{L}\p{N}_. -]{1,120}$/u.test(name) || name.includes('..') || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) throw new Error('Invalid attachment name');
  return name;
}
