import definitions from "./checkpointSchema.json";

type Shape =
  | "number"
  | "string"
  | "boolean"
  | {
      ref?: string;
      literal?: unknown;
      union?: Shape[];
      intersection?: Shape[];
      array?: Shape;
      tuple?: Shape[];
      properties?: Record<string, Shape>;
      required?: string[];
      partial?: Shape;
      record?: Shape;
      set?: Shape;
      map?: [Shape, Shape];
    };
const schemas = definitions as unknown as Record<string, Shape>;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

// Validate the complete simulation schema before trusting imported state.
// The schema is generated from types.ts; primitive combat invariants are
// checked separately by the checkpoint codec. Infinity is an explicit,
// tagged ability deadline in that codec, never an unparsed JSON number.
const matches = (value: unknown, shape: Shape, depth = 0, partial = false): boolean => {
  if (depth > 50) return false;
  if (typeof shape === "string")
    return typeof value === shape && (shape !== "number" || !Number.isNaN(value));
  const check = (v: unknown, s: Shape) => matches(v, s, depth + 1);
  if (shape.ref) return matches(value, schemas[shape.ref], depth + 1, partial);
  if ("literal" in shape) return value === shape.literal;
  if (shape.union) return shape.union.some((s) => check(value, s));
  if (shape.intersection) return shape.intersection.every((s) => check(value, s));
  if (shape.partial) return matches(value, shape.partial, depth + 1, true);
  if (shape.array)
    return (
      Array.isArray(value) && value.length <= 50_000 && value.every((v) => check(v, shape.array!))
    );
  if (shape.tuple)
    return (
      Array.isArray(value) &&
      value.length === shape.tuple.length &&
      shape.tuple.every((s, i) => check(value[i], s))
    );
  if (shape.set) return value instanceof Set && [...value].every((v) => check(v, shape.set!));
  if (shape.map)
    return (
      value instanceof Map &&
      [...value].every(([k, v]) => check(k, shape.map![0]) && check(v, shape.map![1]))
    );
  if (shape.record)
    return object(value) && Object.values(value).every((v) => check(v, shape.record!));
  if (shape.properties) {
    if (!object(value)) return false;
    if (!partial && !shape.required?.every((key) => key in value)) return false;
    return Object.entries(shape.properties).every(
      ([key, s]) => !(key in value) || check(value[key], s),
    );
  }
  return false;
};

export const matchesWorldSchema = (value: unknown) => matches(value, schemas.World);
