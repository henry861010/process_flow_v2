/** Display-only contract composed by the server from the final geometry snapshot. */
export type SchematicRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SchematicShape = {
  id: string;
  itemId: string;
  kind: "rect" | "circle" | "path";
  fill: string;
  stroke: string;
  strokeWidth: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  cx?: number;
  cy?: number;
  r?: number;
  points?: [number, number][];
  closed?: boolean;
  clip?: SchematicRectangle & { exclusions: SchematicRectangle[] };
};

export type SchematicItem = {
  id: string;
  label: string;
  material: string;
  groupLabel: string;
  sourceIds: string[];
  zMin: number;
  zMax: number;
  thickness: number;
};

export type SchematicComponent = SchematicRectangle & {
  id: string;
  label: string;
  sourceIds: string[];
};

export type SchematicDocument = {
  schemaVersion: 1;
  unit: string;
  viewBox: [number, number, number, number];
  shapes: SchematicShape[];
  items: SchematicItem[];
  components: SchematicComponent[];
  totalThickness: number;
  notes: string[];
  warnings: string[];
};
