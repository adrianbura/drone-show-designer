import { useState } from "react";
import { Move, RotateCw, Scaling, Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/lib/studio/store";
import { useI18n } from "@/i18n";
import { prepareImportedEdit, type ImportedEditTransaction } from "@/lib/import/essp/native/editTransaction";
import { clipSceneGroups, groupOfClip } from "@/lib/import/essp/native/sceneGroups";
import { startFullShowAnalysis } from "@/lib/studio/fullShowAnalysis";
import type { AgentOp } from "@/lib/agent/operations";

export default function ImportedTransformPanel() {
  const {project,selectedClipId,forensicsReport,referenceLayer,fullShowAnalysisOptions,applyAgentProject,undoTimeline}=useStudio();
  const {language}=useI18n(); const ro=language==="ro";
  const [mode,setMode]=useState<"MOVE_SCENE"|"ROTATE_SCENE"|"SCALE_SCENE">("MOVE_SCENE");
  const [value,setValue]=useState(0.03),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [pending,setPending]=useState<ImportedEditTransaction|null>(null);
  const reference=fullShowAnalysisOptions.reference;
  if (!reference || !selectedClipId || !referenceLayer?.bindings.some(b=>b.clipId===selectedClipId&&b.kind==="SCENE")) return null;
  const preview=async()=>{
    setBusy(true);setPending(null);setMessage("");
    try {
      const group=forensicsReport?groupOfClip(clipSceneGroups(forensicsReport,referenceLayer),selectedClipId):null;
      const op:AgentOp=mode==="MOVE_SCENE"?{kind:mode,offset:[0,value,0]}:mode==="ROTATE_SCENE"?{kind:mode,axis:"Y",degrees:value}:{kind:mode,factor:value};
      const result=prepareImportedEdit(project,reference.show,reference.layer,group?.clipIds??[selectedClipId],op,{assignmentStrategy:fullShowAnalysisOptions.assignmentStrategy??"nearestNeighbor",transitionOverrides:fullShowAnalysisOptions.transitionOverrides??{}});
      if (!result.ok) {setMessage(result.reason);return;}
      const tx=result.transaction;
      const report=await startFullShowAnalysis({project:tx.project,options:{...fullShowAnalysisOptions,reference:{show:reference.show,layer:tx.layer}}},()=>undefined).promise;
      if (report.exportReadiness.status==="BLOCKED") {setMessage(report.errors.slice(0,2).map(e=>e.message).join("; "));return;}
      setPending(tx);
    } catch(e) {setMessage(e instanceof Error?e.message:String(e));} finally {setBusy(false);}
  };
  return <section className="space-y-2" data-testid="imported-transform">
    <p className="text-xs text-muted-foreground">{ro?"Margini fixe · RGB original":"Fixed edges · original RGB"}</p>
    <div className="flex gap-1">{[{kind:"MOVE_SCENE",icon:Move,label:ro?"Mutare Y":"Move Y"},{kind:"ROTATE_SCENE",icon:RotateCw,label:ro?"Rotire Y":"Rotate Y"},{kind:"SCALE_SCENE",icon:Scaling,label:ro?"Scalare":"Scale"}].map(m=><Button key={m.kind} size="icon" variant={mode===m.kind?"secondary":"ghost"} title={m.label} aria-label={m.label} onClick={()=>{setMode(m.kind as typeof mode);setValue(m.kind==="SCALE_SCENE"?1.001:m.kind==="ROTATE_SCENE"?0.1:0.03);setPending(null);}}><m.icon/></Button>)}</div>
    <input className="studio-input" type="number" step="0.001" aria-label={mode==="MOVE_SCENE"?"Offset Y (m)":mode==="ROTATE_SCENE"?"Angle Y (degrees)":"Scale factor"} value={value} onChange={e=>{setValue(Number(e.target.value));setPending(null);}}/>
    <Button size="sm" variant="outline" disabled={busy} onClick={()=>void preview()}>{busy?(ro?"Verificare…":"Checking…"):(ro?"Previzualizare":"Preview")}</Button>
    {pending&&<Button size="sm" onClick={()=>{if(!applyAgentProject(pending.project,pending))setMessage(ro?"Previzualizare expirată":"Stale preview");setPending(null);}}><Check/>{ro?"Aplică":"Apply"}</Button>}
    <Button size="icon" variant="ghost" title="Undo" aria-label="Undo imported edit" onClick={undoTimeline}><Undo2/></Button>
    {message&&<p role="alert" className="text-xs text-destructive">{message}</p>}
  </section>;
}