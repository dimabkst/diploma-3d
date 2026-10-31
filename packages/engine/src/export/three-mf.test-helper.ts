import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { strFromU8, unzipSync } from 'fflate';
import type { TriangleMesh } from '../mesh.ts';

type XmlNode = Record<string, unknown>;

export interface ParsedThreeMf {
  readonly entryNames: readonly string[];
  readonly contentTypes: readonly { extension: string; contentType: string }[];
  readonly relationships: readonly { id: string; target: string; type: string }[];
  readonly modelPath: string;
  readonly model: {
    readonly namespace: string;
    readonly unit: string | undefined;
    readonly title: string | undefined;
    readonly objects: readonly { id: string; type: string; name: string; mesh: TriangleMesh }[];
    readonly buildItems: readonly { objectId: string }[];
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (name) => ['Default', 'Override', 'Relationship', 'metadata', 'object', 'vertex', 'triangle', 'item'].includes(name),
});

function parseXml(bytes: Uint8Array | undefined, path: string): XmlNode {
  if (bytes === undefined) throw new Error(`Missing ${path}`);
  const text = strFromU8(bytes);
  const validation = XMLValidator.validate(text);
  if (validation !== true) throw new Error(`${path} is not well-formed: ${validation.err.msg}`);
  return parser.parse(text) as XmlNode;
}

const nodes = (value: unknown): XmlNode[] => (Array.isArray(value) ? (value as XmlNode[]) : []);
const text = (node: XmlNode, attribute: string): string => String(node[`@${attribute}`]);

// Strict number parsing so that malformed attribute values fail instead of silently becoming NaN or 0.
function decimal(node: XmlNode, attribute: string): number {
  const value = text(node, attribute);
  if (!/^[-+]?((\d+(\.\d+)?)|(\.\d+))([eE][-+]?\d+)?$/.test(value)) throw new Error(`Invalid ST_Number "${value}"`);
  return Number(value);
}

/** Independent reader for tests: follows the package relationships instead of assuming the model part's path. */
export function readThreeMf(bytes: Uint8Array): ParsedThreeMf {
  const entries = unzipSync(bytes);
  const contentTypes = nodes((parseXml(entries['[Content_Types].xml'], '[Content_Types].xml').Types as XmlNode).Default).map(
    (node) => ({ extension: text(node, 'Extension'), contentType: text(node, 'ContentType') }),
  );
  const relationships = nodes((parseXml(entries['_rels/.rels'], '_rels/.rels').Relationships as XmlNode).Relationship).map(
    (node) => ({ id: text(node, 'Id'), target: text(node, 'Target'), type: text(node, 'Type') }),
  );
  const modelTarget = relationships.find(
    (relationship) => relationship.type === 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel',
  )?.target;
  if (modelTarget === undefined) throw new Error('No 3D model relationship');
  const modelPath = modelTarget.replace(/^\//, '');

  const model = parseXml(entries[modelPath], modelPath).model as XmlNode;
  const objects = nodes((model.resources as XmlNode).object).map((object) => {
    const mesh = object.mesh as XmlNode;
    const vertices = nodes((mesh.vertices as XmlNode).vertex);
    const triangles = nodes((mesh.triangles as XmlNode).triangle);
    return {
      id: text(object, 'id'),
      type: text(object, 'type'),
      name: text(object, 'name'),
      mesh: {
        positions: Float32Array.from(vertices.flatMap((vertex) => ['x', 'y', 'z'].map((axis) => decimal(vertex, axis)))),
        triangles: Uint32Array.from(
          triangles.flatMap((triangle) => ['v1', 'v2', 'v3'].map((corner) => decimal(triangle, corner))),
        ),
      },
    };
  });
  const titleNode = nodes(model.metadata).find((node) => text(node, 'name') === 'Title');

  return {
    entryNames: Object.keys(entries),
    contentTypes,
    relationships,
    modelPath,
    model: {
      namespace: text(model, 'xmlns'),
      unit: model['@unit'] as string | undefined,
      title: titleNode === undefined ? undefined : String(titleNode['#text']),
      objects,
      buildItems: nodes((model.build as XmlNode).item).map((item) => ({ objectId: text(item, 'objectid') })),
    },
  };
}
