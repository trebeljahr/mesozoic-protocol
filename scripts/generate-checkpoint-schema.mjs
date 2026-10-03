// Regenerate after changing persistent simulation types. This parses syntax
// only; it neither runs application code nor loads a TypeScript program.
import fs from "node:fs";
import ts from "typescript";

const sources = [
  "src/sim/types.ts",
  "src/sim/runReport.ts",
  "src/flowGeometry.ts",
  "src/progress.ts",
  "src/biomes.ts",
  "src/render/outpostKit.ts",
];
const aliases = new Map();
for (const path of sources) {
  const file = ts.createSourceFile(
    path,
    fs.readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const node of file.statements)
    if (ts.isTypeAliasDeclaration(node)) aliases.set(node.name.text, node.type);
}
const definitions = {};
const reference = (name) => {
  if (!(name in definitions)) {
    definitions[name] = null;
    const type = aliases.get(name);
    if (!type) throw new Error(`Unknown checkpoint type ${name}`);
    definitions[name] = convert(type);
  }
  return { ref: name };
};
const convert = (node) => {
  if (node.kind === ts.SyntaxKind.NumberKeyword) return "number";
  if (node.kind === ts.SyntaxKind.StringKeyword) return "string";
  if (node.kind === ts.SyntaxKind.BooleanKeyword) return "boolean";
  if (ts.isLiteralTypeNode(node)) {
    const text = node.literal.getText();
    return {
      literal:
        text === "null"
          ? null
          : text === "true"
            ? true
            : text === "false"
              ? false
              : ts.isStringLiteral(node.literal)
                ? node.literal.text
                : Number(text),
    };
  }
  if (ts.isParenthesizedTypeNode(node) || ts.isTypeOperatorNode(node)) return convert(node.type);
  if (ts.isUnionTypeNode(node)) return { union: node.types.map(convert) };
  if (ts.isIntersectionTypeNode(node)) return { intersection: node.types.map(convert) };
  if (ts.isArrayTypeNode(node)) return { array: convert(node.elementType) };
  if (ts.isTupleTypeNode(node)) return { tuple: node.elements.map(convert) };
  if (ts.isTypeLiteralNode(node)) {
    const properties = {};
    const required = [];
    for (const member of node.members) {
      if (!ts.isPropertySignature(member))
        throw new Error(`Unsupported member ${member.getText()}`);
      const key = member.name.getText().replace(/^['"]|['"]$/g, "");
      properties[key] = convert(member.type);
      if (!member.questionToken) required.push(key);
    }
    return { properties, required };
  }
  if (ts.isImportTypeNode(node)) return reference(node.qualifier.getText());
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText();
    const args = node.typeArguments ?? [];
    if (name === "Partial") return { partial: convert(args[0]) };
    if (name === "Readonly") return convert(args[0]);
    if (name === "Record") return { record: convert(args[1]) };
    if (name === "Set" || name === "ReadonlySet") return { set: convert(args[0]) };
    if (name === "Map") return { map: [convert(args[0]), convert(args[1])] };
    if (name === "Array" || name === "ReadonlyArray") return { array: convert(args[0]) };
    return reference(name);
  }
  throw new Error(`Unsupported checkpoint type ${node.getText()}`);
};
reference("World");
fs.writeFileSync(
  "src/persistence/checkpointSchema.json",
  `${JSON.stringify(definitions, null, 2)}\n`,
);
