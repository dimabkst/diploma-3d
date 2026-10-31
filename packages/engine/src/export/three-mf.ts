import { strToU8, zipSync } from 'fflate';
import { GeometryError } from '../errors.ts';
import { assertValidSolidMesh, type TriangleMesh, triangleAt, triangleCount, vertexAt, vertexCount } from '../mesh.ts';

export interface ThreeMfObject {
  readonly name: string;
  /** Millimetres, Z up, counter-clockwise outward-facing triangles: the 3MF core conventions. */
  readonly mesh: TriangleMesh;
}

export interface ThreeMfOptions {
  readonly title?: string;
}

export const THREE_MF_MEDIA_TYPE = 'model/3mf';
export const THREE_MF_MODEL_PATH = '3D/3dmodel.model';

const CORE_NAMESPACE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const MODEL_RELATIONSHIP_TYPE = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';

// fflate encodes the DOS timestamp from local-time getters, so a local-time date yields identical bytes in every time zone.
const ARCHIVE_TIMESTAMP = new Date(2026, 0, 1);

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const RELATIONSHIPS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rel0" Target="/${THREE_MF_MODEL_PATH}" Type="${MODEL_RELATIONSHIP_TYPE}"/>
</Relationships>
`;

/** Packs closed meshes as separate geometry-only objects, each with its own build item; no slicer settings are written. */
export function createThreeMf(objects: readonly ThreeMfObject[], options: ThreeMfOptions = {}): Uint8Array<ArrayBuffer> {
  if (objects.length === 0) {
    throw new GeometryError('A 3MF package needs at least one object.');
  }
  for (const object of objects) {
    assertValidSolidMesh(object.mesh);
  }

  // fflate allocates a regular ArrayBuffer; its typings predate the ArrayBuffer type parameter.
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES_XML),
      '_rels/.rels': strToU8(RELATIONSHIPS_XML),
      [THREE_MF_MODEL_PATH]: strToU8(modelXml(objects, options)),
    },
    { level: 6, mtime: ARCHIVE_TIMESTAMP },
  ) as Uint8Array<ArrayBuffer>;
}

function modelXml(objects: readonly ThreeMfObject[], { title }: ThreeMfOptions): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NAMESPACE}">`,
  ];
  if (title !== undefined) {
    lines.push(` <metadata name="Title">${escapeXml(title)}</metadata>`);
  }
  lines.push(' <resources>');
  objects.forEach((object, index) => {
    lines.push(`  <object id="${index + 1}" type="model" name="${escapeXml(object.name)}">`, '   <mesh>', '    <vertices>');
    for (let vertex = 0; vertex < vertexCount(object.mesh); vertex += 1) {
      const [x, y, z] = vertexAt(object.mesh, vertex).map(formatNumber);
      lines.push(`     <vertex x="${x}" y="${y}" z="${z}"/>`);
    }
    lines.push('    </vertices>', '    <triangles>');
    for (let triangle = 0; triangle < triangleCount(object.mesh); triangle += 1) {
      const [v1, v2, v3] = triangleAt(object.mesh, triangle);
      lines.push(`     <triangle v1="${v1}" v2="${v2}" v3="${v3}"/>`);
    }
    lines.push('    </triangles>', '   </mesh>', '  </object>');
  });
  lines.push(' </resources>', ' <build>');
  objects.forEach((_, index) => {
    lines.push(`  <item objectid="${index + 1}"/>`);
  });
  lines.push(' </build>', '</model>', '');
  return lines.join('\n');
}

// Nine significant digits round-trip any float32 coordinate; String() never emits forms outside the ST_Number pattern.
const formatNumber = (value: number): string => String(Number(value.toPrecision(9)));

const XML_ENTITIES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

const escapeXml = (text: string): string => text.replace(/[&<>"']/g, (character) => XML_ENTITIES[character] ?? character);
