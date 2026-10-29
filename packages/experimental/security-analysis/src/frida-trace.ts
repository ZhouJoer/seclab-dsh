/** Bounded native argument and binary-memory observations for Frida. @module */
import { z } from 'zod'

/** Explicit ABI argument indexes and fixed byte lengths; never implicit C strings. */
export const traceSchema = z.object({
  arguments: z.array(z.number().int().min(0).max(63)),
  returnValue: z.boolean(),
  memory: z.array(z.object({ argument: z.number().int().min(0).max(63),
    length: z.number().int().positive(), when: z.enum(['enter', 'leave']) }).strict()),
  maxCalls: z.number().int().positive(),
}).strict()

/** Build an observation script whose data cannot introduce executable statements.
 * @param module - Exact loaded module name.
 * @param symbol - Exported symbol in that module.
 * @param trace - Validated capture specification.
 * @param maxBytes - Deployment-owned collection limit.
 * @returns Frida script with call identity and explicit partial-result markers.
 */
export function fridaTraceScript(module: string, symbol: string, trace: z.infer<typeof traceSchema>, maxBytes: number): string {
  const bytesPerCall = trace.memory.reduce((sum, region) => sum + region.length * 2, 0) + trace.arguments.length * 32 + 512
  if (bytesPerCall * trace.maxCalls > maxBytes / 2) throw new Error('Trace capture exceeds the observation byte budget')
  return `const spec=${JSON.stringify(trace)};
const m=Process.getModuleByName(${JSON.stringify(module)});
let calls=0, capped=false;
function memory(pointers,when){return spec.memory.filter(r=>r.when===when).map(r=>{
  const pointer=pointers[r.argument];
  try { const bytes=new Uint8Array(pointer.readByteArray(r.length));
    return {argument:r.argument,address:pointer.toString(),length:r.length,hex:Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')};
  } catch(error) {return {argument:r.argument,address:pointer.toString(),length:r.length,error:String(error),incomplete:true};}
});}
Interceptor.attach(m.getExportByName(${JSON.stringify(symbol)}),{
  onEnter(args){
    this.capture=calls<spec.maxCalls;
    if(!this.capture){if(!capped){capped=true;send({incomplete:true,reason:'trace-call-limit',limit:spec.maxCalls});}return;}
    this.call=++calls;this.pointers={};
    for(const r of spec.memory)this.pointers[r.argument]=ptr(args[r.argument].toString());
    const regions=memory(this.pointers,'enter');
    send({call:this.call,phase:'enter',threadId:this.threadId,module:m.name,
      offset:this.context.pc.sub(m.base).toString(),
      arguments:spec.arguments.map(index=>({index,value:args[index].toString()})),memory:regions,
      incomplete:regions.some(r=>r.incomplete===true)});
  },
  onLeave(value){if(!this.capture)return;const regions=memory(this.pointers,'leave');
    send({call:this.call,phase:'leave',threadId:this.threadId,
      returnValue:spec.returnValue?value.toString():null,memory:regions,
      incomplete:regions.some(r=>r.incomplete===true)});}
});`
}
