import { Renderer, Stave, StaveConnector, Stem, type StaveNote } from "vexflow";
import type { NoteName, TargetNote } from "../domain/types";
import type { ResponsiveStaffHorizontalProfile, StaffHorizontalProfile } from "./staffLayoutProfiles";

const NOTE_NAME_ORDER: Record<NoteName, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};
const STAFF_PITCH_BOUNDS = {
  treble: {
    lowest: { noteName: "E", octave: 4 },
    highest: { noteName: "F", octave: 5 },
  },
  bass: {
    lowest: { noteName: "G", octave: 2 },
    highest: { noteName: "A", octave: 3 },
  },
} as const;

export interface StaffFrame {
  staveWidth: number;
  x: number;
}

export interface NoteAreaBounds {
  left: number;
  right: number;
}

export interface GrandStaffAnchors {
  bassY: number;
  trebleY: number;
}

export interface DrawnGrandStaff {
  bass: Stave;
  treble: Stave;
}

export interface StaffRenderSurface {
  context: ReturnType<Renderer["getContext"]>;
  height: number;
  scale: number;
  svg: SVGSVGElement;
  width: number;
}

export function logicalPx(displayPx: number, scale: number): number {
  return displayPx / scale;
}

function targetNoteOrder(note: Pick<TargetNote, "noteName" | "octave">): number {
  return note.octave * 7 + NOTE_NAME_ORDER[note.noteName];
}

export function getLedgerStemDirection(note: TargetNote): typeof Stem.UP | typeof Stem.DOWN | undefined {
  const bounds = STAFF_PITCH_BOUNDS[note.staff];
  const order = targetNoteOrder(note);
  if (order < targetNoteOrder(bounds.lowest)) {
    return Stem.UP;
  }
  if (order > targetNoteOrder(bounds.highest)) {
    return Stem.DOWN;
  }
  return undefined;
}

export function createStaffRenderSurface(
  target: HTMLDivElement,
  displayWidth: number,
  displayHeight: number,
  scale = 1,
): StaffRenderSurface {
  if (!Number.isFinite(scale) || scale < 1) {
    throw new Error(`Staff notation scale must be at least 1, received ${scale}`);
  }

  const resolvedDisplayWidth = Math.max(1, displayWidth);
  const resolvedDisplayHeight = Math.max(1, displayHeight);
  const renderer = new Renderer(target, Renderer.Backends.SVG);
  renderer.resize(resolvedDisplayWidth, resolvedDisplayHeight);
  const context = renderer.getContext();
  if (scale !== 1) {
    context.scale(scale, scale);
  }
  const svg = target.querySelector("svg");
  if (!svg) {
    throw new Error("VexFlow did not create an SVG render surface");
  }
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.removeProperty("width");
  svg.style.removeProperty("height");
  target.style.removeProperty("width");

  return {
    context,
    height: resolvedDisplayHeight / scale,
    scale,
    svg,
    width: resolvedDisplayWidth / scale,
  };
}

export function getResponsiveStaffFrame(
  surface: Pick<StaffRenderSurface, "scale" | "width">,
  columnCount: number,
  profile: ResponsiveStaffHorizontalProfile,
): StaffFrame {
  const preferredContentWidth = logicalPx(
    profile.clefReservePx +
      Math.max(0, columnCount - 1) * profile.preferredColumnGapPx +
      profile.noteAreaSidePaddingPx * 2,
    surface.scale,
  );
  const desiredStaffSidePadding = logicalPx(profile.staffSidePaddingPx, surface.scale);
  const staffSidePadding = Math.min(
    desiredStaffSidePadding,
    Math.max(0, (surface.width - preferredContentWidth) / 2),
  );
  return {
    staveWidth: Math.max(1, surface.width - staffSidePadding * 2),
    x: staffSidePadding,
  };
}

export function getFixedStaffFrame(
  surface: Pick<StaffRenderSurface, "scale" | "width">,
  sidePaddingPx: number,
): StaffFrame {
  const x = logicalPx(sidePaddingPx, surface.scale);
  return {
    staveWidth: Math.max(1, surface.width - x * 2),
    x,
  };
}

export function getGrandStaffAnchors(scale: number, centerYPx: number, gapPx: number): GrandStaffAnchors {
  const centerY = logicalPx(centerYPx, scale);
  const halfGap = logicalPx(gapPx, scale) / 2;
  return {
    bassY: centerY + halfGap,
    trebleY: centerY - halfGap,
  };
}

export function drawGrandStaff(
  context: ReturnType<Renderer["getContext"]>,
  frame: StaffFrame,
  anchors: GrandStaffAnchors,
  options: { brace?: boolean; yOffset?: number } = {},
): DrawnGrandStaff {
  const yOffset = options.yOffset ?? 0;
  const treble = new Stave(frame.x, yOffset + anchors.trebleY, frame.staveWidth).addClef("treble");
  const bass = new Stave(frame.x, yOffset + anchors.bassY, frame.staveWidth).addClef("bass");
  treble.setContext(context).draw();
  bass.setContext(context).draw();
  if (options.brace) {
    new StaveConnector(treble, bass).setType("brace").setContext(context).draw();
  }
  new StaveConnector(treble, bass).setType("singleLeft").setContext(context).draw();
  new StaveConnector(treble, bass).setType("singleRight").setContext(context).draw();
  return { bass, treble };
}

export function getNoteAreaBounds(
  noteStartX: number,
  noteEndX: number,
  columnCount: number,
  scale: number,
  profile: Pick<StaffHorizontalProfile, "minNoteAreaSidePaddingPx" | "noteAreaSidePaddingPx"> &
    Partial<Pick<ResponsiveStaffHorizontalProfile, "preferredColumnGapPx">>,
): NoteAreaBounds {
  const availableWidth = Math.max(1, noteEndX - noteStartX);
  const preferredColumnAreaWidth = logicalPx(
    Math.max(0, columnCount - 1) * (profile.preferredColumnGapPx ?? 0),
    scale,
  );
  const maxSidePadding = Math.max(0, (availableWidth - 1) / 2);
  const minSidePadding = Math.min(
    logicalPx(profile.minNoteAreaSidePaddingPx, scale),
    maxSidePadding,
  );
  const noteAreaSidePadding = Math.min(
    logicalPx(profile.noteAreaSidePaddingPx, scale),
    maxSidePadding,
    Math.max(
      minSidePadding,
      (availableWidth - preferredColumnAreaWidth) / 2,
    ),
  );
  const left = noteStartX + noteAreaSidePadding;
  return {
    left,
    right: Math.max(left + 1, noteStartX + availableWidth - noteAreaSidePadding),
  };
}

export function getGrandStaffNoteArea(
  staves: DrawnGrandStaff,
  columnCount: number,
  scale: number,
  profile: Pick<StaffHorizontalProfile, "minNoteAreaSidePaddingPx" | "noteAreaSidePaddingPx"> &
    Partial<Pick<ResponsiveStaffHorizontalProfile, "preferredColumnGapPx">>,
): NoteAreaBounds {
  return getNoteAreaBounds(
    Math.max(staves.treble.getNoteStartX(), staves.bass.getNoteStartX()),
    Math.min(staves.treble.getNoteEndX(), staves.bass.getNoteEndX()),
    columnCount,
    scale,
    profile,
  );
}

export function getEvenlySpacedCenters(count: number, left: number, right: number): number[] {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [(left + right) / 2];
  }
  const span = Math.max(1, right - left);
  return Array.from({ length: count }, (_, index) => left + (span * index) / (count - 1));
}

export function staveNoteCenterX(note: StaveNote): number {
  return (note.getNoteHeadBeginX() + note.getNoteHeadEndX()) / 2;
}

export function alignStaveNotesToCenters(notes: StaveNote[], centers: readonly number[]): void {
  notes.forEach((note, index) => {
    const center = centers[index];
    if (center === undefined) {
      return;
    }
    const tickContext = note.checkTickContext();
    tickContext.setX(tickContext.getX() + center - staveNoteCenterX(note));
  });
}
