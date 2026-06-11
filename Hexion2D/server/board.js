// board.js — generates the standard Catan board geometry and setup.
// Uses pointy-top hexagons. Vertices/edges are de-duplicated geometrically so
// adjacency between settlements, roads, and hexes is derived automatically.

const HEX_SIZE = 60; // pixel radius of a hex (center to corner)

// Standard Catan resource counts (19 hexes total)
const RESOURCE_BAG = [
  ...Array(4).fill('lumber'),
  ...Array(4).fill('wool'),
  ...Array(4).fill('grain'),
  ...Array(3).fill('brick'),
  ...Array(3).fill('ore'),
  'desert',
];

// Standard number tokens (18 of them, desert gets none)
const NUMBER_BAG = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

// Rows of the classic Catan island: 3-4-5-4-3
const ROW_COUNTS = [3, 4, 5, 4, 3];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function round(n) {
  return Math.round(n);
}

function vKey(x, y) {
  return `${round(x)},${round(y)}`;
}

function eKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Compute the 6 corner points of a pointy-top hex
function hexCorners(cx, cy) {
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    corners.push({ x: cx + HEX_SIZE * Math.cos(angle), y: cy + HEX_SIZE * Math.sin(angle) });
  }
  return corners;
}

function generateBoard() {
  const hexes = [];
  const vertexMap = new Map(); // vKey -> vertex id
  const vertices = []; // {id, x, y, hexes:[], edges:[]}
  const edgeMap = new Map(); // eKey -> edge id
  const edges = []; // {id, v1, v2, x, y}

  const hSpacing = Math.sqrt(3) * HEX_SIZE; // horizontal distance between hex centers
  const vSpacing = 1.5 * HEX_SIZE; // vertical distance between rows

  const originX = 360;
  const originY = 120;

  // Assign resources + numbers
  const resources = shuffle(RESOURCE_BAG);
  const numbers = shuffle(NUMBER_BAG);
  let numIdx = 0;

  // Build hex centers row by row
  ROW_COUNTS.forEach((count, row) => {
    const rowWidth = (count - 1) * hSpacing;
    const startX = originX - rowWidth / 2;
    const cy = originY + row * vSpacing;
    for (let i = 0; i < count; i++) {
      const cx = startX + i * hSpacing;
      const resource = resources[hexes.length];
      const hex = {
        id: hexes.length,
        cx,
        cy,
        resource,
        number: resource === 'desert' ? null : numbers[numIdx++],
        vertices: [],
        edges: [],
      };
      hexes.push(hex);
    }
  });

  // Build vertices + edges from hex corners
  hexes.forEach((hex) => {
    const corners = hexCorners(hex.cx, hex.cy);
    const cornerIds = corners.map((c) => {
      const key = vKey(c.x, c.y);
      if (!vertexMap.has(key)) {
        const id = vertices.length;
        vertexMap.set(key, id);
        vertices.push({ id, x: round(c.x), y: round(c.y), hexes: [], edges: [] });
      }
      const id = vertexMap.get(key);
      if (!vertices[id].hexes.includes(hex.id)) vertices[id].hexes.push(hex.id);
      return id;
    });

    hex.vertices = cornerIds;

    for (let i = 0; i < 6; i++) {
      const a = cornerIds[i];
      const b = cornerIds[(i + 1) % 6];
      const key = eKey(a, b);
      if (!edgeMap.has(key)) {
        const id = edges.length;
        edgeMap.set(key, id);
        const va = vertices[a];
        const vb = vertices[b];
        edges.push({
          id,
          v1: a,
          v2: b,
          x: round((va.x + vb.x) / 2),
          y: round((va.y + vb.y) / 2),
          hexes: [],
        });
        vertices[a].edges.push(id);
        vertices[b].edges.push(id);
      }
      const eid = edgeMap.get(key);
      if (!edges[eid].hexes.includes(hex.id)) edges[eid].hexes.push(hex.id);
      if (!hex.edges.includes(eid)) hex.edges.push(eid);
    }
  });

  // Ports: pick coastal edges (edges touching exactly one hex), spaced around the coast.
  const coastalEdges = edges.filter((e) => e.hexes.length === 1);
  const center = { x: originX, y: originY + vSpacing * (ROW_COUNTS.length - 1) / 2 };
  coastalEdges.sort((a, b) => {
    const angA = Math.atan2(a.y - center.y, a.x - center.x);
    const angB = Math.atan2(b.y - center.y, b.x - center.x);
    return angA - angB;
  });

  const portTypes = shuffle([
    '3:1', '3:1', '3:1', '3:1',
    'brick', 'lumber', 'wool', 'grain', 'ore',
  ]);

  const ports = [];
  // Place 9 ports spaced roughly evenly along the coast.
  // Each port is a boat sitting out in the sea, roped to its two coastal CORNERS.
  const step = Math.floor(coastalEdges.length / 9);
  for (let i = 0; i < 9; i++) {
    const edge = coastalEdges[(i * step) % coastalEdges.length];
    const v1 = vertices[edge.v1];
    const v2 = vertices[edge.v2];
    // outward direction = from board center through the edge midpoint, into the sea
    let dx = edge.x - center.x;
    let dy = edge.y - center.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const OUT = 34; // how far into the sea the boat sits
    ports.push({
      type: portTypes[i],
      edge: edge.id,
      vertices: [edge.v1, edge.v2],
      x: edge.x,
      y: edge.y,
      // boat position (in the water, beyond the coast)
      bx: round(edge.x + dx * OUT),
      by: round(edge.y + dy * OUT),
      // the two corner anchor points the ropes connect to
      anchors: [{ x: v1.x, y: v1.y }, { x: v2.x, y: v2.y }],
    });
  }

  const robber = hexes.findIndex((h) => h.resource === 'desert');

  // Bounding box (including boats) so the client can fit the whole board on screen.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  vertices.forEach((v) => {
    minX = Math.min(minX, v.x); minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y);
  });
  ports.forEach((p) => {
    minX = Math.min(minX, p.bx - 24); minY = Math.min(minY, p.by - 20);
    maxX = Math.max(maxX, p.bx + 24); maxY = Math.max(maxY, p.by + 20);
  });
  const bounds = { minX: round(minX), minY: round(minY), maxX: round(maxX), maxY: round(maxY) };

  return { hexes, vertices, edges, ports, robber, hexSize: HEX_SIZE, center: { x: round(center.x), y: round(center.y) }, bounds };
}

module.exports = { generateBoard, HEX_SIZE };
