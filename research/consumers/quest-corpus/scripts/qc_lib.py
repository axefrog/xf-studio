"""Shared code for the quest corpus database: schema, path classification, and the
extractors that turn quest, quest-phase, scene and journal JSON (as written by
WolvenKit CLI 9.0.1 `convert serialize`) into structure rows.

Only the Python standard library is used.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import sys
import zlib
from collections import Counter

sys.setrecursionlimit(200000)

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

-- One row per game resource that was serialised to JSON. (archive, path) is unique: two
-- archives can hold the same depot path (the later-loaded Phantom Liberty archive wins at run time).
CREATE TABLE IF NOT EXISTS resources (
  id          INTEGER PRIMARY KEY,
  path        TEXT NOT NULL,     -- depot path, lower case, backslash separators
  type        TEXT NOT NULL,     -- file extension: quest, questphase, scene, journal, community, ...
  archive     TEXT NOT NULL,     -- archive the resource came from, relative to the game folder
  area        TEXT NOT NULL,     -- research area that extracted it: A, B, C or H
  category    TEXT NOT NULL,     -- main, side, gig, other, phantom_liberty (see qc_lib.classify)
  subcategory TEXT,              -- finer split, e.g. quest/side_quests, open_world/minor_activities
  quest_key   TEXT,              -- the folder that owns the resource (one quest, gig or system)
  variant     TEXT NOT NULL,     -- live, version (versions/ copies kept for patches) or test
  sha256      TEXT NOT NULL,     -- SHA-256 of the JSON text, uncompressed, as WolvenKit wrote it
  raw_sha256  TEXT,              -- SHA-256 of the extracted game file (area H only)
  bytes       INTEGER NOT NULL,  -- size of the uncompressed JSON text
  json        TEXT,              -- the JSON text; NULL when stored compressed
  json_z      BLOB,              -- zlib-compressed JSON text (scenes); NULL when json is set
  UNIQUE (archive, path)
);
CREATE INDEX IF NOT EXISTS resources_type ON resources (type, area);
CREATE INDEX IF NOT EXISTS resources_quest ON resources (quest_key);
CREATE INDEX IF NOT EXISTS resources_path ON resources (path);

-- One row per quest graph. A quest or phase has a root graph; an inline phase node owns a nested one.
CREATE TABLE IF NOT EXISTS graphs (
  graph_id        INTEGER PRIMARY KEY,
  resource_id     INTEGER NOT NULL,
  parent_graph_id INTEGER,
  owner_node_id   INTEGER,        -- the node of the parent graph that holds this graph
  depth           INTEGER NOT NULL,
  n_nodes         INTEGER NOT NULL,
  n_edges         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS graphs_resource ON graphs (resource_id);

-- One row per quest graph node.
CREATE TABLE IF NOT EXISTS nodes (
  graph_id    INTEGER NOT NULL,
  node_id     INTEGER NOT NULL,   -- the node's id inside its graph
  resource_id INTEGER NOT NULL,
  node_type   TEXT NOT NULL,      -- e.g. questSceneNodeDefinition
  subtype     TEXT,               -- manager or condition class, e.g. questSetVar_NodeType
  ref         TEXT,               -- phase resource, scene file or journal path the node points at
  n_in        INTEGER NOT NULL,   -- edges arriving
  n_out       INTEGER NOT NULL,   -- edges leaving
  PRIMARY KEY (graph_id, node_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS nodes_type ON nodes (node_type);
CREATE INDEX IF NOT EXISTS nodes_resource ON nodes (resource_id);

-- One row per connection between two nodes.
CREATE TABLE IF NOT EXISTS edges (
  graph_id     INTEGER NOT NULL,  -- graph of the source node
  src_node     INTEGER NOT NULL,
  src_socket   TEXT,
  dst_graph_id INTEGER NOT NULL,  -- graph of the destination node (normally the same)
  dst_node     INTEGER NOT NULL,
  dst_socket   TEXT
);
CREATE INDEX IF NOT EXISTS edges_graph ON edges (graph_id, src_node);

-- Every fact name a quest node or scene mentions. role: read (condition), write (set or add), other.
CREATE TABLE IF NOT EXISTS fact_refs (
  resource_id INTEGER NOT NULL,
  graph_id    INTEGER,            -- NULL for scenes
  node_id     INTEGER,            -- NULL for scenes
  fact        TEXT NOT NULL,
  role        TEXT NOT NULL,
  op          TEXT,               -- write: set or add. read: the comparison type
  value       TEXT,
  owner_type  TEXT                -- class of the object that holds the name
);
CREATE INDEX IF NOT EXISTS fact_refs_fact ON fact_refs (fact);
CREATE INDEX IF NOT EXISTS fact_refs_resource ON fact_refs (resource_id);

-- One row per quest or quest-phase resource, with its totals.
CREATE TABLE IF NOT EXISTS phases (
  resource_id   INTEGER PRIMARY KEY,
  path          TEXT NOT NULL,
  kind          TEXT NOT NULL,    -- quest or questphase
  category      TEXT NOT NULL,
  subcategory   TEXT,
  quest_key     TEXT,
  variant       TEXT NOT NULL,
  n_graphs      INTEGER NOT NULL,
  n_nodes       INTEGER NOT NULL,
  n_edges       INTEGER NOT NULL,
  max_depth     INTEGER NOT NULL, -- nesting of inline graphs (0 = no nested graph)
  n_fact_reads  INTEGER NOT NULL,
  n_fact_writes INTEGER NOT NULL,
  n_scene_nodes INTEGER NOT NULL,
  n_journal_nodes INTEGER NOT NULL,
  n_phase_nodes INTEGER NOT NULL
);

-- One row per scene resource.
CREATE TABLE IF NOT EXISTS scenes (
  resource_id     INTEGER PRIMARY KEY,
  path            TEXT NOT NULL,
  category        TEXT NOT NULL,
  subcategory     TEXT,
  quest_key       TEXT,
  variant         TEXT NOT NULL,
  role            TEXT NOT NULL,  -- from the path: quest, gig, ambient_chat, voiceset, holocall, vendor, media, ...
  scene_category  TEXT,           -- the scene's own sceneCategoryTag
  n_graph_nodes   INTEGER NOT NULL,
  n_sections      INTEGER NOT NULL,
  n_choice_nodes  INTEGER NOT NULL,
  n_events        INTEGER NOT NULL, -- events inside section nodes
  n_lines         INTEGER NOT NULL, -- screenplay lines
  n_options       INTEGER NOT NULL, -- screenplay choice options
  n_actors        INTEGER NOT NULL,
  n_player_actors INTEGER NOT NULL,
  n_entry_points  INTEGER NOT NULL,
  n_exit_points   INTEGER NOT NULL,
  n_interruptions INTEGER NOT NULL,
  n_fact_refs     INTEGER NOT NULL  -- 0 for versions, which are not walked for facts
);
CREATE TABLE IF NOT EXISTS scene_node_types (resource_id INTEGER NOT NULL, node_type TEXT NOT NULL, n INTEGER NOT NULL,
  PRIMARY KEY (resource_id, node_type)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS scene_event_types (resource_id INTEGER NOT NULL, event_type TEXT NOT NULL, n INTEGER NOT NULL,
  PRIMARY KEY (resource_id, event_type)) WITHOUT ROWID;

-- The journal tree: folders, quests, phases, objectives, map pins, phone messages, codex entries, ...
CREATE TABLE IF NOT EXISTS journal_entries (
  resource_id INTEGER NOT NULL,
  entry_id    INTEGER NOT NULL,   -- sequence number inside the resource
  parent_id   INTEGER,
  depth       INTEGER NOT NULL,
  name        TEXT,               -- the entry's id string
  path        TEXT NOT NULL,      -- names joined with /
  class       TEXT NOT NULL,      -- e.g. gameJournalQuest
  detail      TEXT,               -- the entry's type field where it has one (MainQuest, SideQuest, ...)
  n_children  INTEGER NOT NULL,
  PRIMARY KEY (resource_id, entry_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS journal_class ON journal_entries (class);

CREATE TABLE IF NOT EXISTS ingest_log (kind TEXT NOT NULL, subject TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS chunks_done (chunk_id TEXT PRIMARY KEY, n_files INTEGER, n_ingested INTEGER, scratch_bytes INTEGER);
"""

VIEWS = """
DROP VIEW IF EXISTS v_resource_counts;
CREATE VIEW v_resource_counts AS
  SELECT area, type, archive, variant, COUNT(*) AS n, SUM(bytes) AS json_bytes
  FROM resources GROUP BY area, type, archive, variant;

DROP VIEW IF EXISTS v_node_type_counts;
CREATE VIEW v_node_type_counts AS
  SELECT n.node_type, p.category, COUNT(*) AS n
  FROM nodes n JOIN phases p ON p.resource_id = n.resource_id
  WHERE p.variant = 'live' GROUP BY n.node_type, p.category;

DROP VIEW IF EXISTS v_fact_usage;
CREATE VIEW v_fact_usage AS
  SELECT fact,
         SUM(role = 'read')  AS reads,
         SUM(role = 'write') AS writes,
         COUNT(DISTINCT resource_id) AS resources
  FROM fact_refs GROUP BY fact;

DROP VIEW IF EXISTS v_quest_scenes;
CREATE VIEW v_quest_scenes AS
  SELECT quest_key, category, COUNT(*) AS n_scenes, SUM(n_lines) AS n_lines, SUM(n_choice_nodes) AS n_choice_nodes
  FROM scenes WHERE variant = 'live' GROUP BY quest_key, category;

DROP VIEW IF EXISTS v_quest_graph_size;
CREATE VIEW v_quest_graph_size AS
  SELECT quest_key, category, COUNT(*) AS n_resources, SUM(n_nodes) AS n_nodes, SUM(n_edges) AS n_edges,
         SUM(n_fact_reads) AS fact_reads, SUM(n_fact_writes) AS fact_writes, SUM(n_scene_nodes) AS scene_nodes
  FROM phases WHERE variant = 'live' GROUP BY quest_key, category;

DROP VIEW IF EXISTS v_scene_refs;
CREATE VIEW v_scene_refs AS
  SELECT lower(ref) AS scene_path, COUNT(*) AS n_refs
  FROM nodes WHERE node_type = 'questSceneNodeDefinition' AND ref IS NOT NULL GROUP BY lower(ref);
"""


# --------------------------------------------------------------------------------------
# Classification
# --------------------------------------------------------------------------------------

NOISE_DIRS = {"phases", "scenes", "scene", "test", "tests", "versions", "debug", "profiling"}


def classify(path: str) -> tuple[str, str, str, str]:
    """Return (category, subcategory, quest_key, variant) for a lower-case depot path."""
    p = path.lower().split("\\")
    d = p[:-1]
    if p[0] == "ep1":
        cat = "phantom_liberty"
        sub = "/".join(p[1:3]) if len(p) > 3 else (p[1] if len(p) > 1 else "")
    elif p[:3] == ["base", "quest", "main_quests"] or (len(p) == 3 and p[:2] == ["base", "quest"] and p[2].startswith("cyberpunk2077.")):
        cat, sub = "main", "quest/main_quests"
    elif p[:3] == ["base", "quest", "side_quests"]:
        cat, sub = "side", "quest/side_quests"
    elif p[:3] == ["base", "quest", "minor_quests"]:
        cat, sub = "side", "quest/minor_quests"
    elif p[:3] == ["base", "open_world", "street_stories"]:
        cat, sub = "gig", "open_world/street_stories"
    else:
        cat = "other"
        sub = "/".join(p[:3]) if len(p) > 3 else "/".join(p[:-1])
        # drop the leading 'base/' so subcategory reads quest/holocalls, open_world/minor_activities
        sub = sub[5:] if sub.startswith("base/") else sub
    # variant
    if any(c in ("test", "tests") for c in p[:-1]):
        variant = "test"
    elif "versions" in p[:-1]:
        variant = "version"
    else:
        variant = "live"
    # quest key: the directory above the first noise folder (searched from the fourth level on)
    cut = len(d)
    for i in range(3, len(d)):
        if d[i] in NOISE_DIRS:
            cut = i
            break
    key = "\\".join(d[:cut]) if cut >= 2 else "\\".join(d)
    return cat, sub, key, variant


def scene_role(path: str) -> str:
    """What a scene is for, judged from where it lives."""
    p = path.lower()
    if "\\voicesets\\" in p or "\\vsets\\" in p:
        return "voiceset"
    if "\\holocalls\\" in p or "_holocall" in p:
        return "holocall"
    if "\\vendors\\" in p or "\\generic_vendors\\" in p:
        return "vendor"
    if p.startswith(("base\\media\\", "ep1\\media\\", "base\\sound\\", "ep1\\sound\\")):
        return "media"
    if "\\street_stories\\" in p:
        return "gig"
    if "\\fixers\\" in p:
        return "fixer"
    if "\\minor_activities\\" in p or "\\sandbox_activities\\" in p or "\\mini_world_stories\\" in p or "\\world_stories\\" in p:
        return "open_world_activity"
    if "\\city_scenes\\" in p:
        return "city_scene"
    if "\\scenes\\chats\\" in p or "\\scene\\chats\\" in p:
        return "ambient_chat"
    if "\\scenes\\conversations\\" in p or "\\scene\\conversations\\" in p:
        return "ambient_conversation"
    if "\\open_world\\scenes\\" in p or "\\openworld\\scene\\" in p or "\\community\\" in p:
        return "ambient_other"
    if "\\main_quests\\" in p:
        return "main_quest"
    if "\\side_quests\\" in p or "\\minor_quests\\" in p:
        return "side_quest"
    if "\\quest\\" in p or "\\openworld\\" in p or "\\open_world\\" in p:
        return "quest_other"
    return "other"


# --------------------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------------------

def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sval(x):
    """Unwrap WolvenKit's CName / ResourcePath wrappers to a plain value."""
    if isinstance(x, dict):
        if "$value" in x:
            return x["$value"]
        if "DepotPath" in x:
            return sval(x["DepotPath"])
        return None
    return x


FACT_KEY = re.compile(r"^fact(name)?\d*$", re.I)


def walk_facts(o, role="read", out=None, nested=None, skip=("sockets",)):
    """Collect fact-name mentions below `o`. Nested quest graphs are set aside in `nested`
    (they get their own nodes); `skip` names keys not to descend into."""
    if out is None:
        out = []
    if isinstance(o, list):
        for v in o:
            if isinstance(v, (dict, list)):
                walk_facts(v, role, out, nested, skip)
        return out
    if not isinstance(o, dict):
        return out
    t = o.get("$type")
    if t == "questGraphDefinition" and nested is not None:
        nested.append(o)
        return out
    if t == "questSetVar_NodeType":
        role = "write"
    elif t == "questSetProgress_NodeType":
        role = "other"
    for k, v in o.items():
        if k in skip:
            continue
        if FACT_KEY.match(k):
            name = sval(v)
            if isinstance(name, str) and name and name != "None":
                if role == "write":
                    op = "set" if o.get("setExactValue") else "add"
                else:
                    op = o.get("comparisonType")
                val = o.get("value")
                out.append((name, role, op if isinstance(op, str) else None,
                            None if val is None else str(val), t))
        elif isinstance(v, (dict, list)):
            walk_facts(v, role, out, nested, skip)
    return out


# --------------------------------------------------------------------------------------
# Quest and quest-phase graphs
# --------------------------------------------------------------------------------------

def _handle(o):
    if not isinstance(o, dict):
        return None
    return o.get("HandleId") or o.get("HandleRefId")


class GraphCtx:
    def __init__(self):
        self.sock: dict[str, tuple] = {}     # socket handle -> (name, type)
        self.owner: dict[str, tuple] = {}    # socket handle -> (graph index, node id)
        self.conns: dict[str, tuple] = {}    # connection handle -> (source socket, destination socket)
        self.unresolved = 0


def _register_socket_tree(first, ctx: GraphCtx):
    """Register a socket handle object and, without recursion, everything reachable through its connections."""
    stack = [("s", first)]
    while stack:
        kind, o = stack.pop()
        h = _handle(o)
        d = o.get("Data") if isinstance(o, dict) else None
        if d is None:
            continue
        if kind == "s":
            if h in ctx.sock:
                continue
            ctx.sock[h] = (sval(d.get("name")), d.get("type"))
            for c in d.get("connections", ()):
                stack.append(("c", c))
        else:
            if h in ctx.conns:
                continue
            src, dst = d.get("source"), d.get("destination")
            ctx.conns[h] = (_handle(src), _handle(dst))
            if src is not None:
                stack.append(("s", src))
            if dst is not None:
                stack.append(("s", dst))


def _node_summary(nd: dict):
    """(subtype, ref) of a quest node."""
    t = nd.get("$type")
    sub = ref = None
    if t == "questPhaseNodeDefinition":
        ref = sval(nd.get("phaseResource"))
        sub = "inline" if nd.get("phaseGraph") else "resource"
    elif t == "questSceneNodeDefinition":
        ref = sval(nd.get("sceneFile"))
    else:
        th = nd.get("type")
        td = th.get("Data") if isinstance(th, dict) else None
        if isinstance(td, dict):
            sub = td.get("$type")
            ph = td.get("path")
            pd = ph.get("Data") if isinstance(ph, dict) else None
            if isinstance(pd, dict):
                ref = pd.get("realPath")
        ch = nd.get("condition")
        cd = ch.get("Data") if isinstance(ch, dict) else None
        if isinstance(cd, dict):
            sub = cd.get("$type")
            ih = cd.get("type")
            idd = ih.get("Data") if isinstance(ih, dict) else None
            if isinstance(idd, dict) and idd.get("$type"):
                sub = f"{sub}/{idd['$type']}"
    if isinstance(ref, (int, float)):
        ref = str(ref)
    return sub, ref


def extract_quest(db: sqlite3.Connection, rid: int, root: dict, p) -> dict:
    """Insert graphs, nodes, edges and fact references for a quest or quest-phase resource.
    `p` is the (category, subcategory, quest_key, variant, path, kind) tuple of the resource."""
    ctx = GraphCtx()
    graphs: list[dict] = []          # {gid, parent, owner, depth, nodes:[...]}
    node_rows: list[list] = []
    fact_rows: list[tuple] = []

    top = []
    g = root.get("graph")
    if isinstance(g, dict) and isinstance(g.get("Data"), dict):
        top.append(g["Data"])
    for ip in root.get("inplacePhases") or ():
        d = ip.get("Data") if isinstance(ip, dict) else None
        gg = d.get("graph") if isinstance(d, dict) else None
        if isinstance(gg, dict) and isinstance(gg.get("Data"), dict):
            top.append(gg["Data"])

    work = [(gd, None, None, 0) for gd in top]
    while work:
        gd, parent, owner, depth = work.pop(0)
        gi = len(graphs)
        gr = {"gid": None, "idx": gi, "parent": parent, "owner": owner, "depth": depth, "nodes": 0}
        graphs.append(gr)
        for nh in gd.get("nodes", ()):
            nd = nh.get("Data") if isinstance(nh, dict) else None
            if not isinstance(nd, dict):
                continue
            nid = nd.get("id")
            for s in nd.get("sockets", ()):
                hh = _handle(s)
                if hh is not None:
                    ctx.owner[hh] = (gi, nid)
                _register_socket_tree(s, ctx)
            sub, ref = _node_summary(nd)
            nested: list = []
            for fact, role, op, val, ot in walk_facts(nd, "read", [], nested):
                fact_rows.append((gi, nid, fact, role, op, val, ot))
            node_rows.append([gi, nid, nd.get("$type"), sub, ref, 0, 0])
            gr["nodes"] += 1
            for ng in nested:
                work.append((ng, gi, nid, depth + 1))

    # insert graphs (parent first: BFS order guarantees it)
    cur = db.cursor()
    for gr in graphs:
        pg = graphs[gr["parent"]]["gid"] if gr["parent"] is not None else None
        cur.execute("INSERT INTO graphs (resource_id, parent_graph_id, owner_node_id, depth, n_nodes, n_edges) VALUES (?,?,?,?,?,0)",
                    (rid, pg, gr["owner"], gr["depth"], gr["nodes"]))
        gr["gid"] = cur.lastrowid

    # edges
    node_index = {(r[0], r[1]): r for r in node_rows}
    edge_rows = []
    per_graph_edges = Counter()
    for sh, dh in ctx.conns.values():
        so, do = ctx.owner.get(sh), ctx.owner.get(dh)
        if so is None or do is None:
            ctx.unresolved += 1
            continue
        edge_rows.append((graphs[so[0]]["gid"], so[1], ctx.sock.get(sh, (None,))[0],
                          graphs[do[0]]["gid"], do[1], ctx.sock.get(dh, (None,))[0]))
        per_graph_edges[so[0]] += 1
        a = node_index.get(so)
        b = node_index.get(do)
        if a:
            a[6] += 1
        if b:
            b[5] += 1
    cur.executemany("INSERT INTO edges VALUES (?,?,?,?,?,?)", edge_rows)
    cur.executemany("INSERT OR IGNORE INTO nodes VALUES (?,?,?,?,?,?,?,?)",
                    [(graphs[r[0]]["gid"], r[1], rid, r[2], r[3], r[4], r[5], r[6]) for r in node_rows])
    cur.executemany("INSERT INTO fact_refs VALUES (?,?,?,?,?,?,?,?)",
                    [(rid, graphs[r[0]]["gid"], r[1], r[2], r[3], r[4], r[5], r[6]) for r in fact_rows])
    for gr in graphs:
        cur.execute("UPDATE graphs SET n_edges=? WHERE graph_id=?", (per_graph_edges[gr["idx"]], gr["gid"]))

    cat, sub, key, variant, path, kind = p
    tc = Counter(r[2] for r in node_rows)
    n_reads = sum(1 for r in fact_rows if r[3] == "read")
    n_writes = sum(1 for r in fact_rows if r[3] == "write")
    cur.execute("INSERT INTO phases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (rid, path, kind, cat, sub, key, variant, len(graphs), len(node_rows), len(edge_rows),
                 max((g_["depth"] for g_ in graphs), default=0), n_reads, n_writes,
                 tc["questSceneNodeDefinition"], tc["questJournalNodeDefinition"], tc["questPhaseNodeDefinition"]))
    return {"unresolved_edges": ctx.unresolved, "n_graphs": len(graphs)}


# --------------------------------------------------------------------------------------
# Scenes
# --------------------------------------------------------------------------------------

def extract_scene(db: sqlite3.Connection, rid: int, root: dict, p, walk: bool) -> None:
    cat, sub, key, variant, path = p
    sg = ((root.get("sceneGraph") or {}).get("Data")) or {}
    nodes = sg.get("graph") or []
    tcount = Counter()
    ecount = Counter()
    n_sections = n_choice = n_events = 0
    for nh in nodes:
        nd = nh.get("Data") if isinstance(nh, dict) else None
        if not isinstance(nd, dict):
            continue
        t = nd.get("$type")
        tcount[t] += 1
        if t == "scnSectionNode":
            n_sections += 1
            for e in nd.get("events", ()):
                ed = e.get("Data") if isinstance(e, dict) else None
                if isinstance(ed, dict):
                    ecount[ed.get("$type")] += 1
                    n_events += 1
        elif t == "scnChoiceNode":
            n_choice += 1
    n_fact = 0
    if walk:
        rows = []
        for part in (sg, root.get("interruptionScenarios")):
            if part:
                rows.extend(walk_facts(part, "read", []))
        db.executemany("INSERT INTO fact_refs VALUES (?,NULL,NULL,?,?,?,?,?)",
                       [(rid, f, r, o, v, ot) for f, r, o, v, ot in rows])
        n_fact = len(rows)
    sp = root.get("screenplayStore") or {}
    db.execute("INSERT INTO scenes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
               (rid, path, cat, sub, key, variant, scene_role(path), root.get("sceneCategoryTag"),
                len(nodes), n_sections, n_choice, n_events,
                len(sp.get("lines") or ()), len(sp.get("options") or ()),
                len(root.get("actors") or ()), len(root.get("playerActors") or ()),
                len(root.get("entryPoints") or ()), len(root.get("exitPoints") or ()),
                len(root.get("interruptionScenarios") or ()), n_fact))
    db.executemany("INSERT INTO scene_node_types VALUES (?,?,?)", [(rid, k, v) for k, v in tcount.items() if k])
    db.executemany("INSERT INTO scene_event_types VALUES (?,?,?)", [(rid, k, v) for k, v in ecount.items() if k])


# --------------------------------------------------------------------------------------
# Journal
# --------------------------------------------------------------------------------------

def extract_journal(db: sqlite3.Connection, rid: int, root: dict) -> int:
    top = root.get("entry")
    if not isinstance(top, dict):
        return 0
    rows = []
    # iterative depth-first walk: (handle object, parent entry id, parent path, depth)
    stack = [(top, None, "", 0)]
    counter = 0
    seen_handles: dict[str, int] = {}
    while stack:
        h, parent, ppath, depth = stack.pop()
        d = h.get("Data") if isinstance(h, dict) else None
        if not isinstance(d, dict):
            continue
        counter += 1
        eid = counter
        name = d.get("id") if isinstance(d.get("id"), str) else None
        path = f"{ppath}/{name}" if ppath else (name or "")
        kids = d.get("entries") or ()
        detail = d.get("type")
        if not isinstance(detail, str):
            detail = None
        rows.append((rid, eid, parent, depth, name, path, d.get("$type"), detail, len(kids)))
        for k in reversed(kids):
            stack.append((k, eid, path, depth + 1))
    db.executemany("INSERT INTO journal_entries VALUES (?,?,?,?,?,?,?,?,?)", rows)
    return len(rows)


# --------------------------------------------------------------------------------------
# Ingest one resource
# --------------------------------------------------------------------------------------

STRUCTURED = {"quest", "questphase", "scene", "journal"}


def ingest_resource(db: sqlite3.Connection, *, path: str, archive: str, area: str, raw: bytes,
                    raw_sha256: str | None = None, log=None) -> int | None:
    """Add one JSON resource (bytes as written by WolvenKit) and its structure rows.
    Returns the resource id, or None when (archive, path) is already present."""
    path = path.lower()
    typ = path.rsplit(".", 1)[-1]
    cat, sub, key, variant = classify(path)
    if db.execute("SELECT 1 FROM resources WHERE archive=? AND path=?", (archive, path)).fetchone():
        return None
    compress = typ == "scene"
    cur = db.execute(
        "INSERT INTO resources (path,type,archive,area,category,subcategory,quest_key,variant,sha256,raw_sha256,bytes,json,json_z)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (path, typ, archive, area, cat, sub, key, variant, sha256_bytes(raw), raw_sha256, len(raw),
         None if compress else raw.decode("utf-8"), zlib.compress(raw, 6) if compress else None))
    rid = cur.lastrowid
    if typ in STRUCTURED:
        try:
            root = json.loads(raw)["Data"]["RootChunk"]
        except Exception as e:  # keep the resource, note the failure
            db.execute("INSERT INTO ingest_log VALUES ('parse_failed', ?, ?)", (path, repr(e)[:300]))
            return rid
        if typ in ("quest", "questphase"):
            info = extract_quest(db, rid, root, (cat, sub, key, variant, path, typ))
            if info["unresolved_edges"]:
                db.execute("INSERT INTO ingest_log VALUES ('unresolved_edges', ?, ?)", (path, str(info["unresolved_edges"])))
        elif typ == "scene":
            extract_scene(db, rid, root, (cat, sub, key, variant, path), walk=(variant != "version"))
        elif typ == "journal":
            extract_journal(db, rid, root)
    return rid


def open_db(path: str, create: bool = False) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    if create:
        db.execute("PRAGMA page_size=8192")
    db.execute("PRAGMA journal_mode=DELETE")
    db.execute("PRAGMA synchronous=OFF")
    db.executescript(SCHEMA)
    return db


def read_json(db: sqlite3.Connection, resource_id: int):
    """Parsed JSON of a resource (decompresses scenes)."""
    row = db.execute("SELECT json, json_z FROM resources WHERE id=?", (resource_id,)).fetchone()
    text = row[0] if row[0] is not None else zlib.decompress(row[1]).decode("utf-8")
    return json.loads(text)
