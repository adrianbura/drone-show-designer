import type { Vector3Tuple } from "../../../show/types";
import { quatFromEulerDeg, rotateByQuat } from "../../../show/dynamic/math";
import { rawPositionAt } from "../playback";
import { esspToStudio } from "../coordinates";
import type { ReferenceDrone, ReferenceShow } from "../types";

export interface TaperedMotionEdit {
  readonly kind: "MOVE_SCENE" | "ROTATE_SCENE" | "SCALE_SCENE";
  readonly clipIds: readonly string[];
  readonly start: number;
  readonly end: number;
  readonly rampSeconds: number;
  readonly pivot: Vector3Tuple;
  readonly offset?: Vector3Tuple;
  readonly axis?: "X" | "Y" | "Z";
  readonly degrees?: number;
  readonly factor?: number;
}

/** Quintic rise/fall with zero added velocity/acceleration at both edges. */
export function taperWeight(time: number, edit: TaperedMotionEdit): number {
  if (time <= edit.start || time >= edit.end) return 0;
  const u = Math.min(1, (time-edit.start)/edit.rampSeconds, (edit.end-time)/edit.rampSeconds);
  return u*u*u*(10+u*(-15+6*u));
}

export function taperedPosition(
  drone: ReferenceDrone, time: number, timing: ReferenceShow["timing"],
  edits: readonly TaperedMotionEdit[],
): Vector3Tuple {
  let p: Vector3Tuple = esspToStudio(rawPositionAt(drone, Math.max(0,time), timing.positionRateHz));
  for (const edit of edits) {
    const w = taperWeight(time, edit);
    if (!w) continue;
    const c=edit.pivot;
    if (edit.kind === "MOVE_SCENE") {
      const d=edit.offset;
      if (!d) throw new Error("Missing move offset");
      p=[p[0]+w*d[0],p[1]+w*d[1],p[2]+w*d[2]];
    } else if (edit.kind === "SCALE_SCENE") {
      const k=1+w*((edit.factor??1)-1);
      p=[c[0]+k*(p[0]-c[0]),c[1]+k*(p[1]-c[1]),c[2]+k*(p[2]-c[2])];
    } else {
      const angles: Vector3Tuple = edit.axis === "X" ? [w*(edit.degrees??0),0,0]
        : edit.axis === "Y" ? [0,w*(edit.degrees??0),0] : [0,0,w*(edit.degrees??0)];
      const r=rotateByQuat([p[0]-c[0],p[1]-c[1],p[2]-c[2]],quatFromEulerDeg(angles));
      p=[c[0]+r[0],c[1]+r[1],c[2]+r[2]];
    }
  }
  return p;
}

/** Derivatives use the same source-clock stencil as unchanged ESSP motion. */
export function taperedKinematics(
  drone: ReferenceDrone,time: number,timing: ReferenceShow["timing"],edits: readonly TaperedMotionEdit[],
) {
  const h=1/timing.positionRateHz;
  const at=(t:number)=>taperedPosition(drone,t,timing,edits);
  const p=at(time),a=at(time-h),b=at(time+h),aa=at(time-2*h),bb=at(time+2*h);
  const map=(fn:(i:number)=>number):Vector3Tuple=>[fn(0),fn(1),fn(2)];
  return { position:p,
    velocity:map(i=>((b[i]??0)-(a[i]??0))/(2*h)),
    acceleration:map(i=>((b[i]??0)-2*(p[i]??0)+(a[i]??0))/(h*h)),
    jerk:map(i=>((bb[i]??0)-2*(b[i]??0)+2*(a[i]??0)-(aa[i]??0))/(2*h*h*h)),
  };
}