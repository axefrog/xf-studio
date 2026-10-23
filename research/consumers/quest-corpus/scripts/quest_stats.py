"""Generate research/story-engine/quest-corpus-statistics.md from the corpus database.

    python quest_stats.py --db quest-corpus.sqlite --out research/story-engine/quest-corpus-statistics.md

Only `live` resources are counted (versions/ copies kept for patches and test/ folders are listed
separately). Everything printed is computed here, so the page can be regenerated after a rebuild.
"""

from __future__ import annotations

import argparse
import sqlite3
import statistics
from collections import Counter, defaultdict

CATS = ["main", "side", "gig", "other", "phantom_liberty"]
CAT_LABEL = {"main": "Main", "side": "Side", "gig": "Gig", "other": "Other", "phantom_liberty": "Phantom Liberty"}


def fmt(n) -> str:
    if n is None:
        return "-"
    if isinstance(n, float):
        return f"{n:,.1f}"
    return f"{n:,}"


def table(headers, rows, align=None) -> str:
    out = ["| " + " | ".join(headers) + " |"]
    out.append("|" + "|".join("---:" if (i > 0 and (align is None or align[i] == "r")) else "---" for i, _ in enumerate(headers)) + "|")
    for r in rows:
        out.append("| " + " | ".join(fmt(c) if not isinstance(c, str) else c for c in r) + " |")
    return "\n".join(out)


def dist(vals):
    vals = sorted(vals)
    if not vals:
        return [0, None, None, None, None]
    p90 = vals[min(len(vals) - 1, int(0.9 * len(vals)))]
    return [len(vals), statistics.mean(vals), statistics.median(vals), p90, vals[-1]]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    db = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    q = lambda sql, *p: db.execute(sql, p).fetchall()
    md: list[str] = []
    w = md.append

    meta = dict(q("SELECT key, value FROM meta"))
    w("# Quest corpus statistics\n")
    w("Structure statistics of the game's authored quest data (game 2.31, base game and Phantom Liberty), "
      "generated from the corpus database by `research/consumers/quest-corpus/scripts/quest_stats.py`. "
      "Rerun it after any rebuild; do not edit the numbers by hand. "
      "The database and how to rebuild it are described in the [scripts README](../consumers/quest-corpus/scripts/README.md). "
      "This is offline data from the game's files: it describes how the quests are built, not how they play.\n")

    # ------------------------------------------------------------------ scope
    w("## 1. What is counted\n")
    rows = q("SELECT type, area, COUNT(*), SUM(bytes) FROM resources GROUP BY type, area ORDER BY type, area")
    by_type = defaultdict(dict)
    for t, ar, n, b in rows:
        by_type[t][ar] = n
    core = ["quest", "questphase", "scene", "journal"]
    w("Resources in the database, by type and the research area that extracted them "
      "(A: main story, B: gigs and fixers, C: population and communities, H: everything else):\n")
    areas = ["A", "B", "C", "H"]
    trs = []
    for t in core + sorted(set(by_type) - set(core)):
        tot = sum(by_type[t].values())
        trs.append([t] + [by_type[t].get(x, 0) for x in areas] + [tot])
    trs.append(["**all**"] + [sum(by_type[t].get(x, 0) for t in by_type) for x in areas] + [sum(sum(v.values()) for v in by_type.values())])
    w(table(["Type"] + [f"Area {x}" for x in areas] + ["Total"], trs) + "\n")
    w("Only quests, quest phases, scenes and journals have structure tables; the other types (communities, "
      "appearance and entity files, CSV tables, a streaming sector) are stored as JSON for later areas.\n")
    vr = q("SELECT type, variant, COUNT(*) FROM resources WHERE type IN ('quest','questphase','scene','journal') GROUP BY type, variant ORDER BY type, variant")
    w("**Variants.** `live` resources are the shipped ones. `version` resources are older copies the game keeps under "
      "`versions/` folders (`gold`, `patchN`), and `test` resources sit in `test/` or `tests/` folders. Statistics below count "
      "`live` only, so each quest is counted once and test content does not distort the shape.\n")
    w(table(["Type", "live", "version", "test"],
            [[t] + [next((n for tt, v, n in vr if tt == t and v == var), 0) for var in ("live", "version", "test")] for t in core]) + "\n")
    w("**Categories.** `main`: `base/quest/main_quests` and the master graph `cyberpunk2077.quest`. `side`: `side_quests` and "
      "`minor_quests`. `gig`: `open_world/street_stories` (the gigs). `phantom_liberty`: everything under `ep1/`. "
      "`other`: the rest of the base game (holocalls, minor activities, combat events, city scenes, vendors, bug-fix "
      "and framework phases, media). A **quest** below means a `quest_key`: the folder that owns a quest or a "
      "gig, with all its phases and scenes.\n")

    cat_rows = []
    for c in CATS:
        r = q("SELECT type, COUNT(*) FROM resources WHERE category=? AND variant='live' AND type IN ('quest','questphase','scene') GROUP BY type", c)
        d = dict(r)
        keys = q("SELECT COUNT(DISTINCT quest_key) FROM resources WHERE category=? AND variant='live' AND type='quest'", c)[0][0]
        cat_rows.append([CAT_LABEL[c], keys, d.get("quest", 0), d.get("questphase", 0), d.get("scene", 0)])
    w(table(["Category", "Quest folders with a .quest", ".quest files", "Phases", "Scenes"], cat_rows) + "\n")

    # ------------------------------------------------------------------ node types
    w("## 2. Node types\n")
    tot_nodes = q("SELECT COUNT(*) FROM nodes n JOIN phases p USING(resource_id) WHERE p.variant='live'")[0][0]
    tot_edges = q("SELECT COUNT(*) FROM edges e JOIN graphs g ON g.graph_id=e.graph_id JOIN phases p ON p.resource_id=g.resource_id WHERE p.variant='live'")[0][0]
    n_graph = q("SELECT COUNT(*) FROM graphs g JOIN phases p USING(resource_id) WHERE p.variant='live'")[0][0]
    n_type = q("SELECT COUNT(DISTINCT node_type) FROM nodes n JOIN phases p USING(resource_id) WHERE p.variant='live'")[0][0]
    w(f"Live quests and phases hold **{fmt(tot_nodes)} nodes** and **{fmt(tot_edges)} connections** in "
      f"{fmt(n_graph)} graphs (a phase node can carry an inline graph of its own), using {n_type} node types. "
      "Counts per type, with the share of all nodes and the split by category:\n")
    cnt = defaultdict(Counter)
    for t, c, n in q("SELECT node_type, category, n FROM v_node_type_counts"):
        cnt[t][c] = n
    order = sorted(cnt, key=lambda t: -sum(cnt[t].values()))
    nrows = []
    for t in order[:40]:
        s = sum(cnt[t].values())
        nrows.append([f"`{t}`", s, f"{100*s/tot_nodes:.1f}%"] + [cnt[t].get(c, 0) for c in CATS])
    w(table(["Node type", "Nodes", "Share"] + [CAT_LABEL[c] for c in CATS], nrows) + "\n")
    rest = order[40:]
    if rest:
        w(f"{len(rest)} further node types make up the remaining {100*sum(sum(cnt[t].values()) for t in rest)/tot_nodes:.1f}% "
          "(query `v_node_type_counts` for them).\n")
    w("**Subtypes.** Manager and condition nodes carry their real meaning in a subtype. The most used:\n")
    srows = q("SELECT n.node_type, n.subtype, COUNT(*) c FROM nodes n JOIN phases p USING(resource_id) "
              "WHERE p.variant='live' AND n.subtype IS NOT NULL AND n.node_type<>'questPhaseNodeDefinition' "
              "GROUP BY 1,2 ORDER BY c DESC LIMIT 25")
    w(table(["Node type", "Subtype", "Nodes"], [[f"`{a1}`", f"`{b1}`", c1] for a1, b1, c1 in srows], align=["l", "l", "r"]) + "\n")

    # ------------------------------------------------------------------ phase sizes
    w("## 3. Phase sizes\n")
    w("Nodes per quest or phase resource (a `.quest` is a top-level graph that starts phases; a `.questphase` is a graph "
      "that can nest others):\n")
    prow = []
    for c in CATS + [None]:
        for kind in ("questphase", "quest"):
            if c:
                vals = [r[0] for r in q("SELECT n_nodes FROM phases WHERE variant='live' AND category=? AND kind=?", c, kind)]
            else:
                vals = [r[0] for r in q("SELECT n_nodes FROM phases WHERE variant='live' AND kind=?", kind)]
            n, mean, med, p90, mx = dist(vals)
            prow.append([CAT_LABEL.get(c, "**All**"), kind, n, mean, med, p90, mx])
    w(table(["Category", "Kind", "Resources", "Mean nodes", "Median", "90th pct", "Max"], prow, align=["l", "l", "r", "r", "r", "r", "r"]) + "\n")
    buckets = [(0, 5), (6, 10), (11, 25), (26, 50), (51, 100), (101, 250), (251, 500), (501, 10**9)]
    sizes = [r[0] for r in q("SELECT n_nodes FROM phases WHERE variant='live' AND kind='questphase'")]
    brow = []
    for lo, hi in buckets:
        n = sum(1 for s in sizes if lo <= s <= hi)
        brow.append([f"{lo}-{hi}" if hi < 10**9 else f"{lo}+", n, f"{100*n/len(sizes):.1f}%"])
    w("Distribution of phase sizes (live `.questphase` files):\n")
    w(table(["Nodes", "Phases", "Share"], brow) + "\n")
    w("The ten largest live phases:\n")
    w(table(["Phase", "Nodes", "Connections", "Nested depth"],
            [[f"`{p}`", n, e, d_] for p, n, e, d_ in q("SELECT path, n_nodes, n_edges, max_depth FROM phases WHERE variant='live' ORDER BY n_nodes DESC LIMIT 10")],
            align=["l", "r", "r", "r"]) + "\n")

    # ------------------------------------------------------------------ graph size and shape
    w("## 4. Graph size and shape by category\n")
    w("Per quest folder (all its live phases together), by category. Edges per node measures how connected the graphs are "
      "(a pure chain is about 1.0); nested depth is how deeply inline graphs sit inside each other.\n")
    grow = []
    for c in CATS:
        r = q("SELECT quest_key, n_resources, n_nodes, n_edges FROM v_quest_graph_size WHERE category=?", c)
        nn = [x[2] for x in r]
        tn, te = sum(x[2] for x in r), sum(x[3] for x in r)
        n, mean, med, p90, mx = dist(nn)
        depth = q("SELECT MAX(max_depth) FROM phases WHERE variant='live' AND category=?", c)[0][0]
        grow.append([CAT_LABEL[c], n, tn, te, f"{te/tn:.2f}" if tn else "-", mean, med, p90, mx, depth])
    w(table(["Category", "Quest folders", "Nodes", "Connections", "Edges per node", "Mean nodes per folder", "Median", "90th pct", "Max", "Max nested depth"], grow) + "\n")
    w("Largest quest folders by node count:\n")
    w(table(["Folder", "Category", "Resources", "Nodes", "Connections", "Scene nodes"],
            [[f"`{k}`", CAT_LABEL.get(c, c), nr, nn, ne, sn] for k, c, nr, nn, ne, sn in
             q("SELECT quest_key, category, n_resources, n_nodes, n_edges, scene_nodes FROM v_quest_graph_size ORDER BY n_nodes DESC LIMIT 12")],
            align=["l", "l", "r", "r", "r", "r"]) + "\n")

    # ------------------------------------------------------------------ branching
    w("## 5. Branching factor\n")
    w("Out-degree is the number of connections leaving a node. A node with out-degree 2 or more is a **fork**: it either "
      "starts parallel branches (several connections from one socket) or has several exits (a condition's True and False). "
      "Dead ends are nodes with no way on (terminating outputs, end-of-branch nodes).\n")
    od = defaultdict(Counter)
    for c, d_, n in q("SELECT p.category, n.n_out, COUNT(*) FROM nodes n JOIN phases p USING(resource_id) WHERE p.variant='live' GROUP BY 1,2"):
        od[c][d_] += n
    brow = []
    for c in CATS + [None]:
        h = od[c] if c else sum(od.values(), Counter())
        tot = sum(h.values())
        with_out = tot - h.get(0, 0)
        mean_all = sum(k * v for k, v in h.items()) / tot
        mean_nz = sum(k * v for k, v in h.items()) / with_out
        forks = sum(v for k, v in h.items() if k >= 2)
        brow.append([CAT_LABEL.get(c, "**All**"), tot, f"{100*h.get(0,0)/tot:.1f}%", f"{100*h.get(1,0)/tot:.1f}%",
                     f"{100*forks/tot:.1f}%", f"{mean_all:.2f}", f"{mean_nz:.2f}", max(h)])
    w(table(["Category", "Nodes", "Out-degree 0", "Out-degree 1", "Forks (2+)", "Mean out-degree", "Mean where > 0", "Max"], brow) + "\n")
    w("Branching by node type (the types that fork most often, among types with at least 200 nodes):\n")
    trow = []
    for t, n, mean, forks, mx in q("SELECT n.node_type, COUNT(*), AVG(n.n_out), SUM(n.n_out>=2), MAX(n.n_out) "
                                   "FROM nodes n JOIN phases p USING(resource_id) WHERE p.variant='live' "
                                   "GROUP BY 1 HAVING COUNT(*)>=200 ORDER BY 1.0*SUM(n.n_out>=2)/COUNT(*) DESC LIMIT 15"):
        trow.append([f"`{t}`", n, f"{mean:.2f}", f"{100*forks/n:.1f}%", mx])
    w(table(["Node type", "Nodes", "Mean out-degree", "Forks", "Max"], trow) + "\n")
    w("Distinct exit sockets used per node (a measure of true alternatives, as opposed to parallel starts):\n")
    sock = defaultdict(Counter)
    for c, k, n in q("SELECT category, ns, COUNT(*) FROM (SELECT p.category category, COUNT(DISTINCT e.src_socket) ns "
                     "FROM edges e JOIN graphs g ON g.graph_id=e.graph_id JOIN phases p ON p.resource_id=g.resource_id "
                     "WHERE p.variant='live' GROUP BY e.graph_id, e.src_node) GROUP BY 1,2"):
        sock[c][k] += n
    srow = []
    for c in CATS:
        h = sock[c]
        tot = sum(h.values())
        srow.append([CAT_LABEL[c], tot, f"{100*h.get(1,0)/tot:.1f}%", f"{100*sum(v for k,v in h.items() if k>=2)/tot:.1f}%",
                     f"{sum(k*v for k,v in h.items())/tot:.2f}"])
    w(table(["Category", "Nodes with an exit", "One socket used", "Two or more sockets used", "Mean sockets used"], srow) + "\n")

    # ------------------------------------------------------------------ facts
    w("## 6. Fact usage\n")
    nfacts = q("SELECT COUNT(DISTINCT fact) FROM fact_refs fr JOIN resources r ON r.id=fr.resource_id WHERE r.variant='live'")[0][0]
    rw = dict(q("SELECT role, COUNT(*) FROM fact_refs fr JOIN resources r ON r.id=fr.resource_id WHERE r.variant='live' GROUP BY role"))
    w(f"Quest nodes and scenes mention **{fmt(nfacts)} distinct fact names**: {fmt(rw.get('read',0))} reads (conditions), "
      f"{fmt(rw.get('write',0))} writes (set or add) and {fmt(rw.get('other',0))} other references (achievement progress). "
      "Only literal names in the data count: facts set or read from scripts, or built at run time, are not visible here. "
      "Scenes contribute only the reads inside their graphs and interruption rules.\n")
    frow = []
    for c in CATS:
        r = q("SELECT fr.role, COUNT(*), COUNT(DISTINCT fr.fact), COUNT(DISTINCT fr.resource_id) FROM fact_refs fr JOIN resources r ON r.id=fr.resource_id "
              "WHERE r.variant='live' AND r.category=? GROUP BY fr.role", c)
        d_ = {x[0]: x for x in r}
        nd = q("SELECT COUNT(DISTINCT fr.fact) FROM fact_refs fr JOIN resources r ON r.id=fr.resource_id WHERE r.variant='live' AND r.category=?", c)[0][0]
        frow.append([CAT_LABEL[c], nd, d_.get("read", (0, 0))[1], d_.get("write", (0, 0))[1]])
    w(table(["Category", "Distinct facts", "Read references", "Write references"], frow) + "\n")
    fu = q("SELECT fact, SUM(role='read'), SUM(role='write'), COUNT(DISTINCT resource_id) FROM fact_refs fr JOIN resources r ON r.id=fr.resource_id "
           "WHERE r.variant='live' GROUP BY fact")
    w("Most read facts:\n")
    w(table(["Fact", "Reads", "Writes", "Resources"], [[f"`{f}`", r_, w_, n] for f, r_, w_, n in sorted(fu, key=lambda x: -x[1])[:25]]) + "\n")
    w("Most written facts:\n")
    w(table(["Fact", "Writes", "Reads", "Resources"], [[f"`{f}`", w_, r_, n] for f, r_, w_, n in sorted(fu, key=lambda x: -x[2])[:25]]) + "\n")
    wo = sum(1 for f, r_, w_, n in fu if w_ and not r_)
    ro = sum(1 for f, r_, w_, n in fu if r_ and not w_)
    both = sum(1 for f, r_, w_, n in fu if r_ and w_)
    once = sum(1 for f, r_, w_, n in fu if r_ + w_ == 1)
    w(f"Of {fmt(len(fu))} facts: {fmt(both)} are both written and read in the data, {fmt(wo)} are written but never read here "
      f"(read by scripts, by other mods, or left over), {fmt(ro)} are read but never written here (set by scripts or by the engine), "
      f"and {fmt(once)} appear exactly once.\n")
    per = defaultdict(list)
    for key, c, cnt_ in q("SELECT r.quest_key, r.category, COUNT(DISTINCT fr.fact) FROM fact_refs fr JOIN resources r ON r.id=fr.resource_id "
                          "WHERE r.variant='live' AND r.quest_key IS NOT NULL GROUP BY 1,2"):
        per[c].append(cnt_)
    prow = []
    for c in CATS:
        n, mean, med, p90, mx = dist(per[c])
        prow.append([CAT_LABEL[c], n, mean, med, p90, mx])
    w("Distinct facts touched per quest folder:\n")
    w(table(["Category", "Folders with facts", "Mean", "Median", "90th pct", "Max"], prow) + "\n")

    # ------------------------------------------------------------------ scenes
    w("## 7. Scenes\n")
    ns = q("SELECT COUNT(*) FROM scenes WHERE variant='live'")[0][0]
    w(f"{fmt(ns)} live scenes. A scene's **role** is judged from where it lives; a scene is **referenced** when a quest "
      "scene node points at it.\n")
    rrow = []
    for role, n, lines, ch in q("SELECT role, COUNT(*), SUM(n_lines), SUM(n_choice_nodes) FROM scenes WHERE variant='live' GROUP BY role ORDER BY 2 DESC"):
        ref = q("SELECT COUNT(*) FROM scenes s JOIN v_scene_refs v ON v.scene_path=s.path WHERE s.variant='live' AND s.role=?", role)[0][0]
        rrow.append([role, n, ref, f"{100*ref/n:.0f}%", lines, ch])
    w(table(["Role", "Scenes", "Referenced by a quest node", "Share", "Screenplay lines", "Choice nodes"], rrow, align=["l", "r", "r", "r", "r", "r"]) + "\n")
    w("Scenes per quest folder, by category (folders that own at least one live scene):\n")
    spq = defaultdict(list)
    for k, c, n in q("SELECT quest_key, category, n_scenes FROM v_quest_scenes"):
        spq[c].append(n)
    srow = []
    for c in CATS:
        n, mean, med, p90, mx = dist(spq[c])
        tot = sum(spq[c])
        srow.append([CAT_LABEL[c], n, tot, mean, med, p90, mx])
    w(table(["Category", "Folders with scenes", "Scenes", "Mean per folder", "Median", "90th pct", "Max"], srow) + "\n")
    w("Scenes per quest proper, counting only folders that have a `.quest` file (folders with no scene count as 0):\n")
    has_q = q("SELECT DISTINCT category, quest_key FROM resources WHERE type='quest' AND variant='live'")
    sc = {(c, k): n for k, c, n in q("SELECT quest_key, category, n_scenes FROM v_quest_scenes")}
    qrow = []
    for c in CATS:
        vals = [sc.get((cc, k), 0) for cc, k in has_q if cc == c]
        n, mean, med, p90, mx = dist(vals)
        qrow.append([CAT_LABEL[c], n, sum(1 for v in vals if v == 0), mean, med, p90, mx])
    w(table(["Category", "Quests", "With no scene", "Mean scenes", "Median", "90th pct", "Max"], qrow) + "\n")
    w("Quests (folders with a `.quest`) with the most scenes:\n")
    w(table(["Folder", "Category", "Scenes", "Screenplay lines", "Choice nodes"],
            [[f"`{k}`", CAT_LABEL.get(c, c), n, l_, ch] for k, c, n, l_, ch in
             q("SELECT v.quest_key, v.category, v.n_scenes, v.n_lines, v.n_choice_nodes FROM v_quest_scenes v "
               "WHERE v.quest_key IN (SELECT quest_key FROM resources WHERE type='quest' AND variant='live') ORDER BY v.n_scenes DESC LIMIT 12")],
            align=["l", "l", "r", "r", "r"]) + "\n")
    w("Scene size and dialogue shape, by category (live scenes, excluding voiceset barks):\n")
    zrow = []
    for c in CATS:
        r = q("SELECT n_graph_nodes, n_lines, n_choice_nodes, n_options, n_actors FROM scenes WHERE variant='live' AND category=? AND role<>'voiceset'", c)
        if not r:
            continue
        zrow.append([CAT_LABEL[c], len(r), statistics.mean(x[0] for x in r), statistics.median(x[1] for x in r), statistics.mean(x[1] for x in r),
                     sum(x[2] for x in r), (sum(x[3] for x in r) / max(1, sum(x[2] for x in r))), statistics.mean(x[4] for x in r)])
    w(table(["Category", "Scenes", "Mean graph nodes", "Median lines", "Mean lines", "Choice nodes", "Options per choice node", "Mean actors"], zrow) + "\n")
    w("Most common scene graph node types and section event types (live scenes):\n")
    w(table(["Scene node type", "Count"], [[f"`{t}`", n] for t, n in q(
        "SELECT t.node_type, SUM(t.n) FROM scene_node_types t JOIN scenes s ON s.resource_id=t.resource_id WHERE s.variant='live' GROUP BY 1 ORDER BY 2 DESC LIMIT 12")]) + "\n")
    w(table(["Section event type", "Count"], [[f"`{t}`", n] for t, n in q(
        "SELECT t.event_type, SUM(t.n) FROM scene_event_types t JOIN scenes s ON s.resource_id=t.resource_id WHERE s.variant='live' GROUP BY 1 ORDER BY 2 DESC LIMIT 15")]) + "\n")

    # ------------------------------------------------------------------ journal
    w("## 8. Journal\n")
    jr = q("SELECT r.path, COUNT(*) FROM journal_entries j JOIN resources r ON r.id=j.resource_id GROUP BY r.id")
    jr = q("SELECT r.path, r.archive, COUNT(*) FROM journal_entries j JOIN resources r ON r.id=j.resource_id GROUP BY r.id")
    w("The cooked journals hold " + ", ".join(f"{fmt(n)} entries (`{p}` from `{ar.rsplit('/', 1)[-1]}`)" for p, ar, n in jr) +
      ". The base journal is stored twice, once per archive that ships it; the Phantom Liberty archive's copy wins at run time. "
      "The class table counts the base-game copy.\n")
    w(table(["Entry class", "Entries"], [[f"`{c}`", n] for c, n in q(
        "SELECT class, COUNT(*) FROM journal_entries j JOIN resources r ON r.id=j.resource_id WHERE r.archive LIKE '%basegame_4_gamedata%' GROUP BY 1 ORDER BY 2 DESC LIMIT 20")]) + "\n")
    qt = q("SELECT detail, COUNT(*) FROM journal_entries j JOIN resources r ON r.id=j.resource_id WHERE class='gameJournalQuest' AND r.archive LIKE '%basegame_4_gamedata%' GROUP BY 1 ORDER BY 2 DESC")
    w("Journal quests by their type field (base game): " + ", ".join(f"`{d_}` {n}" for d_, n in qt) + ".\n")
    jn = q("SELECT COUNT(*), COUNT(DISTINCT ref) FROM nodes n JOIN phases p USING(resource_id) WHERE p.variant='live' AND n.node_type='questJournalNodeDefinition'")[0]
    w(f"Quest graphs reach the journal through {fmt(jn[0])} journal nodes pointing at {fmt(jn[1])} distinct entries.\n")

    # ------------------------------------------------------------------ querying
    w("## 9. How to query\n")
    w("Open the database read-only with any SQLite client (`sqlite3 quest-corpus.sqlite`, Python's `sqlite3`, DB Browser). "
      "Tables: `resources`, `graphs`, `nodes`, `edges`, `fact_refs`, `phases`, `scenes`, `scene_node_types`, "
      "`scene_event_types`, `journal_entries`, `ingest_log`, `meta`; views `v_node_type_counts`, `v_fact_usage`, "
      "`v_quest_scenes`, `v_quest_graph_size`, `v_scene_refs`, `v_resource_counts`. "
      "Join structure tables to `resources` by `resource_id` and filter `variant = 'live'`. "
      "The JSON of non-scene resources is in `resources.json` (use `json_extract`); scenes are zlib-compressed in "
      "`resources.json_z` (the `read_json()` helper in `qc_lib.py` decompresses them; the structure tables already hold the "
      "usual scene counts).\n")
    w("```sql\n"
      "-- Which phases write a fact, and how?\n"
      "SELECT r.path, fr.op, fr.value FROM fact_refs fr JOIN resources r ON r.id = fr.resource_id\n"
      "WHERE fr.fact = 'q101_done' AND fr.role = 'write';\n\n"
      "-- The biggest gigs by node count\n"
      "SELECT quest_key, n_nodes, n_edges, scene_nodes FROM v_quest_graph_size\n"
      "WHERE category = 'gig' ORDER BY n_nodes DESC LIMIT 10;\n\n"
      "-- Nodes that fork, in one phase, with where they lead\n"
      "SELECT n.node_id, n.node_type, e.src_socket, e.dst_node, n2.node_type\n"
      "FROM phases p JOIN graphs g ON g.resource_id = p.resource_id\n"
      "JOIN nodes n ON n.graph_id = g.graph_id AND n.n_out >= 2\n"
      "JOIN edges e ON e.graph_id = n.graph_id AND e.src_node = n.node_id\n"
      "JOIN nodes n2 ON n2.graph_id = e.dst_graph_id AND n2.node_id = e.dst_node\n"
      "WHERE p.path LIKE '%q101_j_03_hallway.questphase';\n\n"
      "-- Scenes a quest folder plays, with their size\n"
      "SELECT s.path, s.n_lines, s.n_choice_nodes FROM scenes s\n"
      "WHERE s.quest_key LIKE '%sq027' AND s.variant = 'live' ORDER BY s.n_lines DESC;\n\n"
      "-- Facts read by a gig but never written anywhere in the corpus\n"
      "SELECT DISTINCT fr.fact FROM fact_refs fr JOIN resources r ON r.id = fr.resource_id\n"
      "WHERE r.category = 'gig' AND fr.role = 'read'\n"
      "  AND NOT EXISTS (SELECT 1 FROM fact_refs w WHERE w.fact = fr.fact AND w.role = 'write');\n\n"
      "-- Raw JSON of one node type, straight from the stored text\n"
      "SELECT json_extract(json, '$.Data.RootChunk.graph.Data.nodes[0].Data.\"$type\"') FROM resources\n"
      "WHERE path LIKE '%q101_cleanup.questphase';\n"
      "```\n")
    w("## 10. Limits\n")
    w("- Counts come from the serialised data only. A quest also lives in scripts, TweakDB records and the journal; none of those add nodes here.\n"
      "- Nested graphs are counted as part of their phase; a `questPhaseNodeDefinition` that points at another `.questphase` is a "
      "reference, not a copy, so reused phases are counted once per file and the folder totals do not multiply them.\n"
      "- Fact names are literal strings in the data. Facts built in scripts and facts the engine sets are invisible; "
      "\"never written\" therefore means \"not written in the data\".\n"
      "- Scene statistics read the scene graph and screenplay store, not the dialogue text.\n"
      "- The category split is by folder. The master graph `cyberpunk2077.quest` is counted as main.\n")
    w(f"\n*Database built {meta.get('built_on', '?')} with {meta.get('tool', 'WolvenKit CLI 9.0.1')}.*\n")

    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(md))
    print("wrote", a.out)


if __name__ == "__main__":
    main()
