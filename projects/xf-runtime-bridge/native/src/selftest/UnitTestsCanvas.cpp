#include "core/overlay/Canvas.hpp"
#include "core/Config.hpp"
#include "core/Win32.hpp"
#include <Windows.h>
#include "core/Dispatcher.hpp"
#include "core/ScriptLayer.hpp"
#include "core/LuaSnapshot.hpp"
#include "core/Recording.hpp"
#include "core/Incidents.hpp"
#include "core/Supervisor.hpp"
#include <cstdio>
#include <fstream>
#include <random>

namespace
{
using namespace xfb::canvas;
int checks = 0, failures = 0;
void Check(bool ok, const char* name) { ++checks; if (!ok) { ++failures; std::printf("CANVAS FAIL %s\n", name); } }
bool Near(double a, double b) { return std::abs(a-b) < 1e-7; }
template<class F> json Refused(F fn) { try { fn(); Check(false,"expected refusal"); return {}; } catch (const Refusal& e) { return e.detail; } }
json Point(std::string id = "p") { return {{"id",id},{"kind","point"},{"anchor",{{"world",{0,10,0}}}}}; }
json BatchOf(json items = json::array({Point()})) { return {{"schema","canvas@1"},{"producer","test"},{"layer","a"},{"world",7},{"seq",1},{"views",{"world","radar"}},{"items",items}}; }
void Ready(Service& s, uint32_t hz = 10, uint32_t count = 16) { xfb::killkey::Chord a,b; std::string why; xfb::killkey::Parse("Insert",a,why); xfb::killkey::Parse("Delete",b,why); s.Configure(true,a,b,hz,count); s.SetWorld(7); s.Toggle(); }
Camera Cam() { Camera c; c.valid=true;c.fov=90;c.width=800;c.height=600;return c; }
void Fixtures()
{
    std::ifstream in(std::filesystem::path(XFB_CANVAS_FIXTURES) / "conformance.json"); json f; in>>f;
    Camera c=Cam();const auto& fixed=f.at("camera");
    c.position=fixed.at("position").get<Vec>();c.forward=fixed.at("forward").get<Vec>();c.right=fixed.at("right").get<Vec>();c.up=fixed.at("up").get<Vec>();
    c.fov=fixed.at("fov").get<double>();c.width=fixed.at("width").get<double>();c.height=fixed.at("height").get<double>();
    for (const auto& v:f["digests"]) { Check(Canonical(v["value"])==v["canonical"].get<std::string>(),"RFC 8785 canonical vector"); Check(Digest(v["value"])==v["sha256"].get<std::string>(),"SHA-256 vector"); }
    for (const auto& v:f["cases"]) {
        if (v.contains("refusal")) { auto refused=Refused([&]{Parse(v["batch"].dump(),{});}); for (const auto& [k,x]:v["refusal"].items()) Check(refused.value(k,json())==x,"shared refusal vector"); }
        else { const auto b=Parse(v["batch"].dump(),{}); for (size_t n=0;n<b.items.size();++n) { XY xy{}; const bool visible=Project(c,b.items[n].anchor.point,xy); const auto& expected=v["projected"][n]; Check(visible!=expected.is_null(),"shared projection visibility"); if (visible) Check(Near(xy[0],expected[0])&&Near(xy[1],expected[1]),"shared projection point"); } }
    }
}
void Parser()
{
    const auto b=BatchOf();
    for (const auto& raw:std::vector<std::string>{"{", "[]", "{\"schema\":\"canvas@1\",\"schema\":\"canvas@1\"}",std::string(40,'[')+std::string(40,']')}) Check(Refused([&]{Parse(raw,{});})["code"]=="bad_batch","malformed/duplicate/depth");
    Check(Refused([&]{Parse(std::string(65537,' '),{});})["cap"]=="bytes","raw byte cap");
    auto checkBad=[&](json j,const char* path){auto refusal=Refused([&]{Parse(j.dump(),{});});Check(refusal["code"]=="bad_batch"&&refusal["path"]==path,"strict path validation");};
    auto j=b;j["wat"]=true;checkBad(j,"$.wat");j=b;j["seq"]=1.1;checkBad(j,"$.seq");j=b;j["world"]=-1;checkBad(j,"$.world");j=b;j["ttl_s"]=.49;checkBad(j,"$.ttl_s");j=b;j["items"][0]["color"]="#ffffff";checkBad(j,"$.items[0].color");
    j=b;j["items"][0]["anchor"]["offset"]={0,0,0};checkBad(j,"$.items[0].anchor.offset");j=b;j["items"][0]["anchor"]={{"screen",{.5,.5}}};checkBad(j,"$.items[0].anchor.screen");
    j=b;j["items"].push_back(Point());checkBad(j,"$.items[1].id");
    j=b;j["items"]=json::array();for(int n=0;n<257;++n)j["items"].push_back(Point(std::to_string(n)));Check(Refused([&]{Parse(j.dump(),{});})["cap"]=="items","batch items cap");
    auto line=Point();line["kind"]="polyline";line["points"]={{0,0,0},{1,0,0}};line["dash"]={.25,.25};
    Check(Parse(BatchOf(json::array({line})).dump(),{}).vertices==4,"world dash units metres");line["points"]={{0,0,0},{1e7,0,0}};line["dash"]={.05,.05};Check(Refused([&]{Parse(BatchOf(json::array({line})).dump(),{});})["cap"]=="vertices","expansion refuses before huge allocation");
    auto circle=Point();circle["kind"]="circle";circle["radius_m"]=1;circle["segments"]=8;Check(Parse(BatchOf(json::array({circle})).dump(),{}).vertices==16,"circle expansion");
    circle["segments"]=64; circle["dash"]={.05,20}; auto gapCircle=Parse(BatchOf(json::array({circle})).dump(),{}).items[0]; Check(gapCircle.worldLines.size()==2 && gapCircle.vertices==128 && SolidVertices(gapCircle)==128,"long-gap circle reserves its solid radar source at admission");
    circle.erase("dash");circle["ground"]=false; auto ring=Parse(BatchOf(json::array({circle})).dump(),{}).items[0];
    auto camera=Cam();camera.forward={-1,0,0};camera.right={0,1,0};XY xy{};
    auto world=WorldVertex(ring,camera,ring.worldLines[0],{-10,0,0});
    Check(Project(camera,world,xy)&&Near(xy[0],430)&&Near(xy[1],300),"camera-facing ring uses camera right/up after yaw");
    camera.forward={0,0,-1};camera.right={1,0,0};camera.up={0,1,0};
    world=WorldVertex(ring,camera,ring.worldLines[32],{0,0,-10});
    Check(Project(camera,world,xy)&&Near(xy[0],400)&&Near(xy[1],270),"camera-facing ring uses camera up when looking down");
    circle["ground"]=true;auto groundRing=Parse(BatchOf(json::array({circle})).dump(),{}).items[0];
    Check(ring.radarLines==groundRing.radarLines,"camera-facing ring radar source equals top-down ground ring");
    RadarView radar;const auto radarA=RadarPoint(camera,radar,ring.radarLines[0]),radarB=RadarPoint(camera,radar,groundRing.radarLines[0]);
    Check(radarA==radarB,"both circle orientations share radar transform");
    auto polygon=Point();polygon["kind"]="polygon";polygon["points"]={{0,0,999},{1,0,999},{1,1,999},{0,1,999}};auto poly=Parse(BatchOf(json::array({polygon})).dump(),{});Check(poly.vertices==12&&poly.items[0].polygon[0][2]==0,"polygon fill plus outline count, ignored z");
    auto box=Point();box["kind"]="box";box["size"]={1,1,1};Check(Parse(BatchOf(json::array({box})).dump(),{}).vertices==24,"box edges count");
    auto chip=Point();chip["kind"]="label";chip["style"]="chip";chip["text"]="test";chip["color"]="muted";auto parsed=Parse(BatchOf(json::array({chip})).dump(),{}).items[0];Check(std::string(TextToken(parsed))=="text","chip contrast uses text, not muted");chip["style"]="plain";parsed=Parse(BatchOf(json::array({chip})).dump(),{}).items[0];Check(std::string(TextToken(parsed))=="muted","plain label retains tone");
    auto panel=Point();panel["kind"]="panel";panel["anchor"]={{"screen",{0,0}}};panel["rect"]={.1,.1,.2,.2};panel["title"]="test";panel["lines"]={{{"text","line"},{"tone","muted"}}};parsed=Parse(BatchOf(json::array({panel})).dump(),{}).items[0];Check(std::string(TextToken(parsed))=="text","panel contrast uses text");
    auto icon=Point();icon["kind"]="icon";icon["glyph"]="warning";Check(Parse(BatchOf(json::array({icon})).dump(),{}).vertices==FindGlyph("warning")->vertices,"generated icon vertices counted");Check(KnownGlyph("warning")&&!KnownGlyph("person"),"glyph fallback vocabulary");
}
void Lifecycle()
{
    xfb::ScriptLayer layer;layer.OnAttach();layer.OnPlayerAttach();const auto initial=layer.WorldGeneration();layer.OnLoadRequested();
    Check(layer.WorldGeneration()==initial+1,"accepted load invalidates world before detach");layer.OnDetach();Check(layer.WorldGeneration()==initial+2,"detach advances generation");layer.InvalidateWorld();Check(layer.WorldGeneration()==initial+3,"kill invalidation advances generation");
    xfb::EventLog events;Service s(&events);Ready(s);auto b=BatchOf();Check(s.Feed(1,b.dump(),0)["accepted"]==true,"feed accepted");
    Check(Refused([&]{s.Feed(2,b.dump(),.1);})["code"]=="producer_in_use","connection identity, not pid");
    Check(Refused([&]{s.Feed(1,b.dump(),.1);})["code"]=="stale_seq","late seq refuses");auto wrong=b;wrong["world"]=6;Check(Refused([&]{s.Feed(1,wrong.dump(),.1);})["code"]=="stale_world","stale world refuses");
    auto st=s.State(.2);Check(st["producers"][0]["layers"][0]["seq"]==1&&st["producers"][0]["layers"][0]["last_refusal"]["code"]=="stale_world","last refusal and atomic previous snapshot");
    Check(s.State(5)["producers"][0]["layers"][0]["items"]==0,"TTL expires exactly at deadline");Check(Refused([&]{s.Feed(1,b.dump(),5.1);})["code"]=="stale_seq","expiry retains seq tombstone");
    s.Clear(1,{{"producer","test"}},6);Check(s.Feed(1,b.dump(),6)["accepted"]==true,"explicit clear releases seq");s.Disconnect(1);Check(s.State(6)["producers"].empty(),"disconnect withdraws immediately");Check(s.Feed(2,b.dump(),6)["accepted"]==true,"producer handoff");
    s.SetWorld(8);Check(s.State(6)["producers"].empty(),"world clears all");s.Stop();Check(s.Feed(1,b.dump(),6)["dropped"]=="hidden","hidden drops without parsing");Check(s.Feed(1,"invalid",6)["dropped"]=="hidden","hidden no retained work");
    s.Toggle();Check(s.State(6)["producers"].empty(),"show requires resend");s.Mode();Check(s.State(6)["mode"]=="radar_world","mode event");
    auto e=events.Read(0,100);bool fed=false,visible=false;size_t refused=0;for(const auto& event:e["events"]){fed|=event["kind"]=="canvas.fed";visible|=event["kind"]=="canvas.visible";if(event["kind"]=="canvas.refused")++refused;}Check(fed&&visible&&refused<=2,"bounded publishing receipts and refusal pacing");
    Check(Refused([&]{s.SetKeys({{"toggle","Ctrl+Insert"}});})["code"]=="bad_batch","keys stay bare");Check(s.SetKeys({{"toggle","F12"}})["toggle"]=="F12","rebind same key route");
    Check(Refused([&]{s.View({{"radar",{{"size_px",1}}}});})["path"]=="$.radar.size_px","view validates");Check(s.View({{"radar",{{"orientation","north_up"}}}})["radar"]["orientation"]=="north_up","view stores");
}
void RatesAndCaps()
{
    Service s;Ready(s);auto b=BatchOf();for(int n=1;n<=4;++n){b["seq"]=n;s.Feed(1,b.dump(),.01*n);}b["seq"]=5;Check(Refused([&]{s.Feed(1,b.dump(),.1);})["code"]=="rate","4 per layer second");Check(s.Feed(1,b.dump(),1.1)["accepted"]==true,"rate recovers");
    Service many;Ready(many);b=BatchOf();for(int n=0;n<16;++n){b["layer"]=std::to_string(n);many.Feed(1,b.dump(),0);}b["layer"]="new";Check(Refused([&]{many.Feed(1,b.dump(),.1);})["cap"]=="layers","16 layer cap");b["layer"]="0";b["seq"]=2;Check(Refused([&]{many.Feed(1,b.dump(),.1);})["code"]=="rate","16 per producer second");
    Service items;Ready(items);b=BatchOf();b["items"]=json::array();for(int n=0;n<256;++n)b["items"].push_back(Point(std::to_string(n)));items.Feed(1,b.dump(),0);auto small=BatchOf();small["layer"]="other";Check(Refused([&]{items.Feed(1,small.dump(),0);})["cap"]=="items","all layers producer item cap");
    for(int n=1;n<4;++n){b["producer"]="p"+std::to_string(n);items.Feed(static_cast<uint64_t>(n+1),b.dump(),0);}small["producer"]="fifth";Check(Refused([&]{items.Feed(8,small.dump(),0);})["cap"]=="total_items","1024 total items");
    Service meta;Ready(meta);auto empty=BatchOf(json::array());for(int n=0;n<1024;++n){empty["producer"]="p"+std::to_string(n);meta.Feed(static_cast<uint64_t>(n+1),empty.dump(),0);}empty["producer"]="overflow";Check(Refused([&]{meta.Feed(2000,empty.dump(),0);})["cap"]=="metadata","metadata bounded with empty feeds");
    auto line=Point();line["kind"]="polyline";line["points"]={{0,0,0},{2048,0,0}};line["dash"]={.5,.5};b=BatchOf(json::array({line}));Check(Parse(b.dump(),{}).vertices==4096,"4096 expanded exact cap");
    Service vertices;Ready(vertices);for(int n=0;n<4;++n){b["producer"]="p"+std::to_string(n);vertices.Feed(static_cast<uint64_t>(n+1),b.dump(),0);}small=BatchOf();small["producer"]="overflow";Check(Refused([&]{vertices.Feed(5,small.dump(),0);})["cap"]=="total_vertices","16384 total vertices");
    small["producer"]="p0";small["layer"]="extra";Check(Refused([&]{vertices.Feed(1,small.dump(),0);})["cap"]=="vertices","4096 across producer layers");
    Service rings;Ready(rings);auto circle=Point();circle["kind"]="circle";circle["radius_m"]=1;circle["segments"]=64;circle["dash"]={.05,20};
    auto circles=BatchOf(json::array());for(int n=0;n<32;++n){circle["id"]=std::to_string(n);circles["items"].push_back(circle);}
    for(int n=0;n<4;++n){circles["producer"]="rings"+std::to_string(n);Check(rings.Feed(static_cast<uint64_t>(n+1),circles.dump(),0)["vertices"]==4096,"long-gap circles reserve 4096 solid vertices per producer");}
    auto extra=BatchOf(json::array({circle}));extra["producer"]="overflow";
    Check(Refused([&]{rings.Feed(5,extra.dump(),0);})["cap"]=="total_vertices","long-gap circles close solid radar baseline at admission");
    auto oldCounterexample=circles;for(int n=32;n<64;++n){circle["id"]=std::to_string(n);oldCounterexample["items"].push_back(circle);}
    Check(Refused([&]{Parse(oldCounterexample.dump(),{});})["cap"]=="vertices","64 long-gap circles cannot undercount their 8192 solid endpoints");
    auto camera=Cam();camera.player={0,10,0};rings.Publish(camera,0,0);const auto& frame=rings.Take();
    std::vector<const Item*> all;for(const auto& layer:frame.layers)for(const auto& item:layer.batch->items)all.push_back(&item);
    size_t budget=RadarExtraBudget(all),downgraded=0,emitted=0;Check(budget==0&&all.size()==128,"full radar frame reserves all 16384 solid endpoints");
    RadarView radar;radar.size=640;radar.range=1;
    for(const auto* item:all){double phase=0;const auto& lines=item->radarLines;
        for(size_t n=0;n+1<lines.size();n+=2){auto a=lines[n],b0=lines[n+1];for(size_t axis=0;axis<3;++axis){a[axis]+=item->anchor.point[axis];b0[axis]+=item->anchor.point[axis];}
            auto x=RadarPoint(camera,radar,a),y=RadarPoint(camera,radar,b0),original=x;const auto length=std::hypot(y[0]-x[0],y[1]-x[1]);
            if(ClipSegment(x,y,radar.size,radar.size))emitted+=RadarSegments(x,y,item->dash,budget,downgraded,phase+std::hypot(x[0]-original[0],x[1]-original[1])).size();
            phase=std::fmod(phase+length,item->dash[0]+item->dash[1]);
        }
    }
    Check(emitted==16384&&downgraded>0&&budget==0,"full frame emits every solid segment within the radar endpoint budget");

}
void ClearRatesAndCapOrder()
{
    Service layer;Ready(layer);auto batch=BatchOf();
    for(int n=0;n<4;++n){layer.Feed(1,batch.dump(),.01*n);layer.Clear(1,{{"producer","test"}},.01*n);}
    Check(layer.State(.04)["producers"].empty(),"clear releases drawing and sequence records");
    Check(Refused([&]{layer.Feed(1,batch.dump(),.04);})["code"]=="rate","clear of last layer cannot bypass 4 per second");
    Check(layer.Feed(2,batch.dump(),1.01)["accepted"]==true,"layer rate window expires independently of ownership");
    Service producer;Ready(producer);
    for(int n=0;n<16;++n){batch["layer"]=std::to_string(n);producer.Feed(1,batch.dump(),0);producer.Clear(1,{{"producer","test"}},0);}
    batch["layer"]="new";Check(Refused([&]{producer.Feed(1,batch.dump(),.1);})["code"]=="rate","cleared producer retains 16 per second across layer churn");
    Service handoff;Ready(handoff);batch=BatchOf();for(int n=0;n<4;++n){batch["seq"]=n;handoff.Feed(1,batch.dump(),0);}handoff.Disconnect(1);
    Check(Refused([&]{handoff.Feed(2,batch.dump(),.1);})["code"]=="rate","disconnect releases owner but not live rate window");
    Service churn;Ready(churn);auto empty=BatchOf(json::array());
    for(int n=0;n<1024;++n){empty["producer"]="p"+std::to_string(n);churn.Feed(1,empty.dump(),0);churn.Clear(1,{{"producer",empty["producer"]}},0);}
    empty["producer"]="new";Check(Refused([&]{churn.Feed(1,empty.dump(),.1);})["cap"]=="metadata","cleared rate history remains bounded by metadata cap");
    Check(churn.Feed(1,empty.dump(),1)["accepted"]==true,"expired rate-only metadata is reclaimed");

    Service order;Ready(order);batch=BatchOf(json::array());for(int n=0;n<256;++n)batch["items"].push_back(Point(std::to_string(n)));batch["layer"]="0";order.Feed(1,batch.dump(),0);
    empty=BatchOf(json::array());for(int n=1;n<16;++n){empty["layer"]=std::to_string(n);order.Feed(1,empty.dump(),0);}
    empty["layer"]="a";for(int n=0;n<1008;++n){empty["producer"]="other"+std::to_string(n);order.Feed(2,empty.dump(),0);}
    auto incoming=BatchOf();incoming["layer"]="overflow";
    auto huge=Point();huge["kind"]="polyline";huge["points"]={{0,0,0},{1e7,0,0}};huge["dash"]={.05,.05};
    auto multiple=incoming;multiple["items"]=batch["items"];multiple["items"].push_back(huge);auto raw=multiple.dump();raw.append(65537-raw.size(),' ');
    Check(Refused([&]{order.Feed(1,raw,.1);})["cap"]=="bytes","raw bytes are a safety prerequisite before all content caps");
    Check(Refused([&]{order.Feed(1,incoming.dump(),.1);})["cap"]=="items","items precede layers metadata and rates");
    incoming["items"]=json::array({huge});Check(Refused([&]{order.Feed(1,incoming.dump(),.1);})["cap"]=="items","global items precede early expansion vertex refusal");
    empty=BatchOf(json::array());empty["layer"]="0";empty["seq"]=2;order.Feed(1,empty.dump(),1.1);
    Check(Refused([&]{order.Feed(1,incoming.dump(),1.1);})["cap"]=="vertices","vertices precede layers and metadata");
    incoming["items"]=json::array({Point()});Check(Refused([&]{order.Feed(1,incoming.dump(),1.1);})["cap"]=="layers","layers precede metadata");
    order.Clear(1,{{"producer","test"},{"layer","0"}},1.1);for(int n=1;n<16;++n){empty["layer"]=std::to_string(n);order.Feed(1,empty.dump(),1.2);}
    Check(Refused([&]{order.Feed(1,incoming.dump(),1.2);})["cap"]=="metadata","metadata precedes producer rate");
    for(int n=0;n<1008;++n)order.Clear(2,{{"producer","other"+std::to_string(n)}},1.2);
    Check(Refused([&]{order.Feed(1,incoming.dump(),1.2);})["code"]=="rate","rate follows the other admission caps");
}
void KeyPersistence()
{
    const auto build=std::filesystem::path(XFB_CANVAS_FIXTURES).parent_path().parent_path()/"build";
    const auto dir=build/("canvas-keys-unit-"+std::to_string(GetCurrentProcessId())+"-"+std::to_string(GetTickCount64()));
    if(dir.parent_path()!=build||!std::filesystem::create_directory(dir))throw std::runtime_error("unique canvas key test directory unavailable");
    struct Cleanup{std::filesystem::path dir;~Cleanup(){std::error_code ec;std::filesystem::remove_all(dir,ec);}}cleanup{dir};
    Service service;Ready(service);service.SetKeys({{"toggle","F12"}});const auto config=dir/"config.ini",backups=dir/"backups";
    Check(PersistKeys(config,backups,service.Keys())["saved"]==false&&!std::filesystem::exists(backups),"missing config refuses persistence before any write");
    const std::string original="[bridge]\nallow_writes=false\n[overlay]\ncanvas_toggle=Insert\ncanvas_mode=Delete\n[log]\nlevel=debug\n";
    {std::ofstream out(config,std::ios::binary);out<<original;}
    const auto locked=CreateFileW(config.c_str(),GENERIC_WRITE,0,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);
    Check(locked!=INVALID_HANDLE_VALUE,"key persistence fixture locks original");const auto refused=PersistKeys(config,backups,service.Keys());if(locked!=INVALID_HANDLE_VALUE)CloseHandle(locked);
    std::string after,why;bool missing=false;xfb::win32::ReadFileExact(config,after,missing,why);
    Check(refused["saved"]==false&&after==original&&!std::filesystem::exists(backups),"failed exact read leaves original and backup directory untouched");
    {std::ofstream out(config,std::ios::binary);out<<std::string(4*1024*1024+1,'x');}
    Check(PersistKeys(config,backups,service.Keys())["saved"]==false&&std::filesystem::file_size(config)==4*1024*1024+1&&!std::filesystem::exists(backups),"oversized exact read cannot replace config with partial content");
    {std::ofstream out(config,std::ios::binary);out<<original;}
    const auto saved=PersistKeys(config,backups,service.Keys());xfb::win32::ReadFileExact(config,after,missing,why);
    Check(saved["saved"]==true&&after.find("canvas_toggle = F12")!=std::string::npos&&after.find("allow_writes=false")!=std::string::npos&&after.find("level=debug")!=std::string::npos,"successful whole read preserves unrelated config and saves keys");
}
void AnchorsAndProjection()
{
    Service s;Ready(s);auto b=BatchOf(json::array());for(int n=1;n<=160;++n){auto p=Point(std::to_string(n));p["anchor"]={{"entity",std::to_string(n)}};b["items"].push_back(p);}s.Feed(1,b.dump(),0);
    auto other=Point("other");other["anchor"]={{"entity","1000"}};auto second=BatchOf(json::array({other}));second["producer"]="other";s.Feed(2,second.dump(),0);
    auto c=Cam();std::set<std::string> visited;
    for(int tick=0;tick<11;++tick){const double at=.1*tick;auto wanted=s.Wanted(at);if(tick==0)Check(std::find(wanted.begin(),wanted.end(),"1000")!=wanted.end(),"small producer gets a slot on first read");Check(wanted.size()<=16,"default 16 entity read cap");std::vector<EntityPosition> positions;for(auto id:wanted){visited.insert(id);positions.push_back({id,Vec{0,10,0}});}s.Resolve(positions,at,.08);s.Publish(c,at,.02);s.Take();Check(s.Wanted(at+.01).empty(),"intervening camera tick does not read anchors");}Check(visited.size()==161,"paced round robin visits every entity across producers");
    const auto measured=s.State(1);Check(measured["anchor_reads"]["configured_hz"]==10&&measured["anchor_reads"]["per_read"]==16&&measured["anchor_reads"]["observed_hz"]==10,"anchor read rate reported separately");
    Check(Near(measured["costs"]["camera"]["last_ms"],.02)&&measured["costs"]["anchors"]["last_ms"].get<double>()>=.08,"camera and per-read anchor times separate");
    Check(s.Wanted(4).size()==16&&s.Wanted(4).empty(),"late tick never catches up with burst reads");

    Service cycle;Ready(cycle);auto sixtyFour=BatchOf(json::array());for(int n=1;n<=64;++n){auto p=Point(std::to_string(n));p["anchor"]={{"entity",std::to_string(n)}};sixtyFour["items"].push_back(p);}cycle.Feed(1,sixtyFour.dump(),0);
    std::set<std::string> refreshed;std::string first;
    for(int read=0;read<4;++read){auto wanted=cycle.Wanted(.1*read);if(read==0)first=wanted[0];std::vector<EntityPosition> points;for(const auto& id:wanted){Check(refreshed.insert(id).second,"round robin does not repeat before full cycle");points.push_back({id,Vec{0,10,0}});}cycle.Resolve(points,.1*read,.03);cycle.Publish(c,.1*read,.01);cycle.Take();}
    Check(refreshed.size()==64&&Near(cycle.State(.3)["anchor_reads"]["expected_refresh_s"],.4),"64 anchors refresh in four scheduled reads");
    cycle.Resolve({{first,std::nullopt}},.4,.03);cycle.Publish(c,.65,.01);Check(cycle.Take().anchors.at(first).state==AnchorState::Resolved,"anchor remains resolved through expected refresh plus 250ms");
    Check(cycle.State(.65)["anchors"]["resolved"]==64,"state and frame share freshness rule");
    cycle.Publish(c,.9,.01);auto held=cycle.Take().anchors.at(first);Check(held.state==AnchorState::Holding&&Near(held.opacity,.85),"holding fade starts after refresh and grace");
    cycle.Publish(c,1.65,.01);Check(Near(cycle.Take().anchors.at(first).opacity,.4),"holding reaches 40 percent after one second");
    cycle.Publish(c,1.651,.01);Check(cycle.Take().anchors.at(first).state==AnchorState::Lost,"lost after grace and one-second fade");
    cycle.Resolve({{first,Vec{1,10,0}}},1.7,.03);cycle.Publish(c,1.7,.01);Check(cycle.Take().anchors.at(first).state==AnchorState::Resolved,"anchor recovers on successful read");
    const auto beforeHidden=cycle.State(1.7)["anchor_reads"]["total"];cycle.Toggle();Check(cycle.Wanted(2).empty()&&cycle.State(2)["anchor_reads"]["total"]==beforeHidden,"hidden schedules no anchor reads");
    for(const auto policy:std::array<std::pair<uint32_t,uint32_t>,2>{{{1,4},{20,32}}}){Service bounded;Ready(bounded,policy.first,policy.second);bounded.Feed(1,sixtyFour.dump(),0);Check(bounded.Wanted(0).size()==policy.second&&bounded.Wanted(.01).empty(),"configured anchor policy limits and paces reads");Check(bounded.Wanted(1.0/policy.first).size()==policy.second,"configured read interval resumes");}
    RadarView r; r.size=200;r.range=10;r.orientation="north_up";auto xy=RadarPoint(c,r,{0,10,0});Check(Near(xy[0],100)&&Near(xy[1],0),"north up");r.orientation="heading_up";c.yaw=90;xy=RadarPoint(c,r,{-10,0,0});Check(Near(xy[0],100)&&Near(xy[1],0),"heading up game yaw");
    size_t budget=16384,downgraded=0;auto dash=RadarSegments({0,0},{10,0},{2,3},budget,downgraded);Check(dash.size()==4&&Near(dash[1][0],2)&&Near(dash[2][0],5),"radar dash pixels independent of metres");RadarSegments({0,0},{1000,0},{.05,.05},budget,downgraded);Check(downgraded==1,"per segment radar downgrade");budget=1;RadarSegments({0,0},{10,0},{1,1},budget,downgraded);Check(downgraded==2,"radar frame downgrade");
    c=Cam();XY a{},q{};Check(ProjectSegment(c,{-1,-1,0},{1,10,0},a,q),"near plane clips segment");Check(!Project(c,{0,-10,0},a),"behind camera culled");auto poly=ProjectPolygon(c,{{-1,-1,-1},{1,10,-1},{1,10,1},{-1,-1,1}});Check(poly.size()>=3,"near clipped polygon remains visible");
}
void CaptureAndFade()
{
    const auto defaults=xfb::ParseConfig("");Check(defaults.canvasAnchorHz==10&&defaults.canvasAnchorsPerRead==16,"anchor policy defaults");
    for(const auto values:std::array<std::pair<uint32_t,uint32_t>,2>{{{1,4},{20,32}}}){const auto settings=xfb::ParseConfig("[overlay]\ncanvas_anchor_hz="+std::to_string(values.first)+"\ncanvas_anchors_per_read="+std::to_string(values.second)+"\n");Check(settings.canvasAnchorHz==values.first&&settings.canvasAnchorsPerRead==values.second,"anchor policy accepts inclusive config bounds");}
    for(const auto raw:{"canvas_anchor_hz=0\ncanvas_anchors_per_read=3\n","canvas_anchor_hz=21\ncanvas_anchors_per_read=33\n","canvas_anchor_hz=1.5\ncanvas_anchors_per_read=no\n"}){const auto settings=xfb::ParseConfig(std::string("[overlay]\n")+raw);Check(settings.canvasAnchorHz==10&&settings.canvasAnchorsPerRead==16&&settings.warnings.size()==2,"invalid anchor policy retains defaults with warnings");}
    const auto disabled=xfb::ParseConfig("[overlay]\ncanvas_toggle=off\ncanvas_mode=Delete\n");Check(!disabled.canvasToggle.enabled&&disabled.canvasMode.enabled,"config accepts disabled canvas key");
    const auto duplicate=xfb::ParseConfig("[overlay]\ncanvas_toggle=Insert\ncanvas_mode=Insert\n");Check(!duplicate.canvasMode.enabled&&!duplicate.warnings.empty(),"duplicate config keys disable mode with warning");
    const auto changed=xfb::killkey::WithSetting("[ui]\nkill_key=End\n[overlay]\ncanvas_toggle=Insert\n[log]\nlevel=debug\n","overlay","canvas_toggle","F12");
    const auto config=xfb::ParseConfig(changed);Check(config.canvasToggle.vk==0x7b&&config.killKey.vk==0x23,"canvas key persistence preserves other sections");
    xfb::overlay::OverlayHost host;host.Configure(true,xfb::overlay::ThemeKind::Dark,100);host.NoteHooks(true,true,true,"");host.NoteInit({},"");
    const auto now=Clock::now();Check(host.ShouldDraw(now),"host initially drawing");host.HideForCapture(true,1000,now);Check(!host.ShouldDraw(now),"ordinary capture suppresses canvas host");
    host.IncludeCanvasForCapture(true);Check(host.ShouldDraw(now)&&host.CanvasOnlyCapture(),"canvas evidence capture allows only canvas");host.SetKilled(true);Check(!host.ShouldDraw(now),"kill overrides canvas evidence flag");
    host.SetKilled(false);Check(!host.HiddenForCapture(now+std::chrono::seconds(2)),"capture deadline expires");host.HideForCapture(false,50);Check(!host.CanvasOnlyCapture(),"restoring capture clears canvas-only state");
    Service service;Ready(service);auto item=Point();item["anchor"]={{"entity","1"}};service.Feed(1,BatchOf(json::array({item})).dump(),10);
    service.Wanted(10);service.Resolve({{"1",Vec{0,10,0}}},10,0);service.Publish(Cam(),10,0);service.Take();
    const double deadline=10+.1+.25;service.Resolve({{"1",std::nullopt}},deadline,0);service.Publish(Cam(),deadline+1,0);
    Check(Near(service.Take().anchors.at("1").opacity,.4),"anchor fade reaches exactly 40 percent after freshness grace and one second");service.Publish(Cam(),deadline+1.001,0);Check(service.Take().anchors.at("1").state==AnchorState::Lost,"anchor lost after fade deadline");
}
void ObserverPacing()
{
    using namespace xfb;
    Config config; Session session; session.token="canvas-pacing";
    GameThreadQueue queue;
    auto now=std::chrono::steady_clock::time_point{};
    double canvasNow=10;
    Dispatcher dispatcher(config,session,queue,[&]{return now;});
    Service service;Ready(service);RegisterMethods(dispatcher,service);
    // Exercise the real service with the same explicit clock as the dispatcher, without wall-clock waits.
    dispatcher.Register({"canvas.feed",Access::Display,RunOn::BridgeThread,"",[&](const MethodContext& c){
        try{return service.Feed(c.connection,c.rawParams,canvasNow);}
        catch(const Refusal& e){MethodError error(e.detail.value("code","failed"),"canvas refusal");error.detail=e.detail;throw error;}
    }});
    dispatcher.Register({"canvas.state",Access::Read,RunOn::BridgeThread,"",[&](const MethodContext&){return service.State(canvasNow);}});
    int catchups=0;
    for(const auto* method:{"bridge.info","test.record.read","session.events","game.digest"})
        dispatcher.Register({method,Access::Read,RunOn::BridgeThread,"",[&](const MethodContext&){++catchups;return json::object();}});
    ReaderRequestBudget budget;
    auto call=[&](const char* method,const json& params,ReaderRequestBudget& credit,uint64_t connection=81){
        return json::parse(dispatcher.Handle(json{{"token",session.token},{"method",method},{"params",params}}.dump(),42,false,&credit,connection).line);
    };
    bool allAccepted=true;
    for(int second=0;second<60;++second){
        now=std::chrono::steady_clock::time_point{}+std::chrono::seconds(second);canvasNow=10+second;
        for(int layer=0;layer<16;++layer){auto b=BatchOf();b["layer"]=std::to_string(layer);b["seq"]=second+1;
            const auto reply=call("canvas.feed",b,budget);allAccepted&=reply.value("ok",false)&&reply.value("result",json::object()).value("accepted",false);}
        // A one-page tool catch-up is three native calls, plus the optional current digest.
        for(const auto* method:{"bridge.info","test.record.read","session.events","game.digest"})
            allAccepted&=call(method,json::object(),budget).value("ok",false);
        allAccepted&=call("canvas.state",json::object(),budget).value("ok",false);
    }
    Check(allAccepted&&catchups==240,"observer sustains 16 feeds/s plus catch-up and state at 1 Hz with read headroom");
    auto extra=BatchOf();extra["layer"]="0";extra["seq"]=100;
    Check(call("canvas.feed",extra,budget)["error"]["code"]=="rate","canvas producer rate still applies inside observer budget");
    ReaderRequestBudget other;
    Check(call("canvas.feed",extra,other,82)["error"]["code"]=="producer_in_use","paced dispatcher preserves connection identity, independently of PID");
    for(const auto* method:{"canvas.feed","canvas.clear","canvas.view"}){
        ReaderRequestBudget small(1);
        call("ping",json::object(),small);call("ping",json::object(),small);
        Check(call(method,json::object(),small)["error"]["code"]!="rate_limited","display calls leave exhausted general budgets untouched");
    }
    ReaderRequestBudget spam;
    bool bounded=true;
    for(int n=0;n<128;++n){auto reply=call("canvas.view",json::object(),spam);if(n>=24)bounded&=reply["error"]["code"]=="rate";}
    int reads=0;for(int n=0;n<41;++n)reads+=call("ping",json::object(),spam).value("ok",false);
    Check(bounded&&reads==40,"display spam is bounded independently and leaves all forty own-reader credits");
    ReaderRequestBudget clean;
    Check(call("ping",json::object(),clean).value("ok",false),"display spam leaves observer aggregate credit");
    auto writer=json::parse(dispatcher.Handle(json{{"token",session.token},{"method","ping"}}.dump(),42).line);
    Check(writer.value("ok",false),"display spam leaves writer tokens untouched");
    auto tooDeep=std::string("{\"id\":17,\"token\":\"canvas-pacing\",\"method\":\"canvas.view\",\"params\":")+std::string(40,'[');
    Check(json::parse(dispatcher.Handle(tooDeep,42,false,&spam,81).line)["error"]["code"]=="rate","display budget refuses before payload depth scan or DOM parsing");
    const auto longId=std::string(300,'i');const auto echoed=json::parse(dispatcher.Handle(json{{"id",longId},{"token",session.token},{"method","canvas.view"}}.dump(),42,false,&spam,81).line);
    Check(echoed["id"]==longId&&echoed["error"]["code"]=="rate","early display refusal preserves scalar request identity");
    DisplayRequestBudget attempts;int admitted=0;auto at=std::chrono::steady_clock::time_point{};
    for(int n=0;n<25;++n)admitted+=attempts.Take(at);
    Check(admitted==24&&!attempts.Take(at)&&attempts.Take(at+std::chrono::milliseconds(63)),"display attempt allowance is burst24 with 16/s refill");
    ModuleDisplayBudgets modules;for(int n=0;n<24;++n)Check(!modules.Admit("holo",at),"CET module receives its display burst");
    Check(modules.Admit("holo",at).has_value()&&!modules.Admit("other",at),"CET module display buckets are independent");
    for(int n=0;n<62;++n)modules.Admit(std::to_string(n),at);
    Check(modules.Admit("overflow",at).has_value()&&!modules.Admit("overflow",at+std::chrono::seconds(2)),"CET module histories are bounded and retire after two idle seconds");
}
void FurnitureAndPersistence()
{
    auto label=Point();label["kind"]="label";label["text"]="legend";label["anchor"]={{"screen",{.1,.1}}};
    auto panel=label;panel["kind"]="panel";panel.erase("text");panel["rect"]={.1,.1,.3,.3};panel["title"]="legend";panel["lines"]=json::array();
    for(const auto& item:{label,panel})for(bool markers:{false,true}){
        auto b=BatchOf(json::array({item}));auto parsed=Parse(b.dump(),{}).items[0];
        Check(DrawInView(parsed,World,markers)&&!DrawInView(parsed,Radar,markers),"screen furniture draws once in both modes, outside radar clip");
        b["views"]={"radar"};parsed=Parse(b.dump(),{}).items[0];Check(!DrawInView(parsed,World,markers),"layer view mask still hides screen furniture");
    }
    auto point=Parse(BatchOf().dump(),{}).items[0];Check(!DrawInView(point,World,false)&&DrawInView(point,World,true)&&DrawInView(point,Radar,false),"only projected world markers depend on mode");
    const auto dir=std::filesystem::current_path()/("xfb-canvas-view-"+std::to_string(GetCurrentProcessId()));
    std::filesystem::create_directory(dir);const auto path=dir/"view.json";
    Service service;Ready(service);service.SetStateFile(path);
    service.View({{"radar",{{"range_m",100}}}},10);Check(!std::filesystem::exists(path)&&!service.FlushView(11.99),"view setting is immediate but persistence waits two seconds");
    service.View({{"radar",{{"range_m",200}}}},11);Check(service.State(11)["radar"]["range_m"]==200&&service.FlushView(12),"debounce writes the last value");
    {std::ifstream file(path);json saved;file>>saved;Check(saved["radar"]["range_m"]==200,"persisted view is newest, not first request");}
    service.View({{"radar",{{"range_m",300}}}},12.1);Check(!service.FlushView(13.9)&&service.FlushView(13.95,true),"shutdown flushes pending final setting");
    std::filesystem::remove(path);
    std::filesystem::create_directory(path); // an existing directory cannot be replaced by the atomic file writer
    service.View({{"radar",{{"range_m",400}}}},15);
    Check(!service.FlushView(17)&&service.State(17)["view_persistence"]["pending"]==true&&
        !service.State(17)["view_persistence"]["error"].get<std::string>().empty(),"failed persistence retains pending state and reports the error");
    std::filesystem::remove(path);
    Check(!service.FlushView(18.99)&&service.FlushView(19)&&service.State(19)["view_persistence"]["pending"]==false&&
        service.State(19)["view_persistence"]["error"]=="","failed persistence retries at the bounded cadence and clears the error");
    std::filesystem::remove(path);std::filesystem::remove(dir);
}
void LuaSnapshots()
{
    using namespace xfb;
    snapshot::Cache cache;snapshot::Lifecycle life{7,false,false};int reads=0;
    snapshot::Inputs input;
    input.recorder={{"world",7},{"active",true},{"run",1},{"channels",{"v","actors"}},
      {"v",{{"entity","1"},{"position",{1,2,3}},{"yaw",10},{"game_time_s",1000},{"vehicle",{{"mounted",false}}},{"vitals",{{"in_combat",true}}}}},{"v_s",10},
      {"actors",json::array({{{"entity","2"},{"position",{2,3,4}},{"yaw",20},{"identity",{{"record","Character.Test"},{"affiliation","Affiliations.Test"},{"crowd",false},{"display_name","secret story text"}}}}})},{"actors_s",10}};
    const auto provider=[&]{++reads;return input;};
    Check(!cache.Tick(life,10,provider)&&reads==0,"SN idle snapshot does no source work before any reader");
    Check(cache.Read(life,10)["cleared"]=="load"&&reads==0,"SN first read copies explicit clear without rebuilding");
    Check(cache.Tick(life,10,provider)&&!cache.Tick(life,10.249,provider)&&cache.Tick(life,10.25,provider)&&reads==2,"SN rebuild is bounded to four per second");
    auto value=cache.Read(life,10.3);Check(value["schema"]=="snapshot@1"&&value["actors"][0]["plan"].is_null()&&value["sources"]["plan"]=="unavailable"&&value.dump().find("secret story")==std::string::npos,"SN strict structural projection omits story text and unavailable plans");
    Check(value["actors"][0]["identity"]["record"]=="Character.Test"&&value["game_time_s"]==1000,"SN identities and game clock come from retained samples");
    value=cache.Read(life,10.6);Check(value["actors"][0]["state"]=="stale"&&Near(value["actors"][0]["age_s"],.6),"SN stale actor always carries age even without rebuild");
    snapshot::Cache invalid;invalid.Read(life,10.6);input.recorder["actors"][0]["valid"]=false;
    invalid.Tick(life,10.6,provider);
    Check(invalid.Read(life,10.6)["actors"][0]["state"]=="lost","SN invalid retained sample never becomes resolved");
    input.recorder["actors"][0].erase("valid");
    value=cache.Read(life,12.01);Check(value["actors"][0]["state"]=="lost","SN expired cached actor never looks current");
    Check(!cache.Tick(life,14.01,provider),"SN rebuild stops exactly two seconds after last read");
    life.handover=true;Check(cache.Read(life,14.02)["actors"][0]["state"]=="lost","SN handover explicitly invalidates actor state");
    life={8,false,false};value=cache.Read(life,14.03);Check(value["cleared"]=="load"&&value["actors"].empty()&&value["v"].is_null(),"SN load clears before another worker tick");
    input.recorder["active"]=false;cache.Tick(life,14.04,provider);value=cache.Read(life,14.05);Check(!value["recorder"]["active"].get<bool>()&&value["sources"]["actors"]=="recorder_stopped"&&value["cleared"]=="load","SN stopped recorder is explicit and cannot restore an old world");
    life.killed=true;value=cache.Read(life,14.06);Check(value["cleared"]=="killed"&&!cache.Tick(life,14.1,provider),"SN kill clear prevents all provider work");
    life={9,false,false};cache.Read(life,15);Check(!cache.Tick(life,15,[&]{cache.Read({10,false,false},15.1);return input;}),"SN in-flight build cannot overwrite a newer world clear");
    snapshot::Cache cold;life={7,false,false};cold.Read(life,15);snapshot::Inputs nativeOnly;
    nativeOnly.incidents.push_back({{"id","i"},{"kind","assault"},{"pos",{1,2,3}},{"opened_s",10},{"closed_s",14},{"perceived",true}});
    cold.Tick(life,15,[&]{return nativeOnly;});Check(cold.Read(life,74)["incidents"].size()==1&&cold.Read(life,74.001)["incidents"].empty(),"SN closed incident horizon still applies to an idle cached read");
    snapshot::Cache full;life={7,false,false};full.Read(life,20);input.recorder["active"]=true;input.recorder["actors"]=json::array();
    for(int n=0;n<32;++n)input.recorder["actors"].push_back({{"entity",std::string(31,'1')+std::to_string(n)},{"position",{1,2,3}},{"identity",{{"record",std::string(200,'r')},{"affiliation",std::string(200,'a')},{"crowd",false}}}});
    for(int n=0;n<32;++n)input.incidents.push_back({{"id",std::to_string(n)},{"kind","assault"},{"pos",{1,2,3}},{"participants",std::vector<std::string>(16,std::string(32,'2'))},{"opened_s",19},{"closed_s",nullptr},{"perceived",true}});
    for(int n=0;n<10;++n)input.holds.push_back({{"id",std::to_string(n)},{"kind","hold_position"},{"radius_m",1},{"pos",{1,2,3}}});
    input.recorder["gaps"]=json::array();for(int n=0;n<12;++n)input.recorder["gaps"].push_back({{"channel","v"},{"from_s",19},{"to_s",20},{"reason","invalid"}});
    full.Tick(life,20,[&]{return input;});value=full.Read(life,20);
    Check(value["actors"][0]["identity"]["record"]==std::string(200,'r'),"SN record identifiers retain their exact value rather than a clipped prefix");
    Check(value.dump().size()<=16384&&value["actors"].size()<=16&&value["incidents"].size()<=16&&value["holds"].size()<=5&&value["recorder"]["gaps"].size()<=8,"SN serialized size and every list are bounded");
    Check(value["truncated"]["actors"]>=16&&value["truncated"]["incidents"]>=16&&value["truncated"]["participants"]>0&&value["truncated"]["holds"]==5&&value["truncated"]["gaps"]==4,"SN all truncation is disclosed");
    for(const auto& i:value["incidents"])Check(i["participants"].size()<=8,"SN participant cap");
    Check(!full.Tick(life,20.3,[]{snapshot::Inputs unavailable;unavailable.recorder={{"available",false}};return unavailable;})&&full.Builds()==1,"SN busy source skips rebuild without discarding the old cache");
    incidents::Service store;store.SetWorld(7);incidents::Observation observation;observation.evidence="gunshot";observation.simS=1;observation.hasPos=true;
    incidents::Fact person;person.id="2";person.roles=incidents::kAggressor;person.inView=true;person.dist=1;person.los=incidents::Los::Clear;observation.who.push_back(person);
    Check(store.Observe(observation,10).accepted,"SN incident fixture observes only existing native evidence");
    auto incidents=store.SnapshotData(7,10);Check(incidents.size()==1&&incidents[0]["participants"][0]=="2"&&incidents[0]["opened_s"]==10&&incidents[0]["closed_s"].is_null(),"SN open incident snapshot contains ids and wall timestamps");
    store.Tick(20,12);incidents=store.SnapshotData(7,72);Check(incidents.size()==1&&incidents[0]["closed_s"]==12&&store.SnapshotData(7,72.001).empty()&&store.SnapshotData(8,12).empty(),"SN closed incidents live sixty seconds and never cross worlds");
    supervisor::Service supervisorOwner;supervisor::Observation observed;observed.valid=true;observed.entity="1";observed.phase="gameplay";
    json entry={{"schema","xfb/supervisor-entry-1"},{"actor",{{"kind","player"},{"ref","V"}}},{"goal",{{"kind","hold_position"},{"at",{1,2,3}},{"radius_m",2}}},{"invariants",{"alive"}},{"policy",{{"goal","return_last_safe"},{"alive","handover"}}}};
    supervisorOwner.Set(entry,observed,10,7,1);const auto holds=supervisorOwner.SnapshotHolds(7);Check(holds.size()==1&&holds[0]["kind"]=="hold_position"&&holds[0]["radius_m"]==2&&!holds[0].contains("policy")&&supervisorOwner.SnapshotHolds(8).empty(),"SN supervisor snapshot exposes scoped goals without policy text");
    recording::Service recorder;auto stopped=recorder.SnapshotData(10,7);Check(!stopped["active"].get<bool>()&&stopped["actors"].empty(),"SN cached source read does not start the recorder");
}
void FuzzAndBench()
{
    std::mt19937 rng(5781);std::vector<std::string> corpus{BatchOf().dump()};
    auto seed=Point(); seed["kind"]="circle";seed["radius_m"]=100;seed["segments"]=64;seed["dash"]={.05,20};corpus.push_back(BatchOf(json::array({seed})).dump());
    seed=Point();seed["kind"]="polyline";seed["points"]={{0,0,0},{1e7,0,0}};seed["dash"]={.05,.05};corpus.push_back(BatchOf(json::array({seed})).dump());
    seed=Point();seed["kind"]="polygon";seed["points"]={{0,0,0},{1,0,0},{1,1,0},{0,1,0}};corpus.push_back(BatchOf(json::array({seed})).dump());
    seed=Point();seed["kind"]="box";seed["size"]={1,1,1};corpus.push_back(BatchOf(json::array({seed})).dump());
    corpus.push_back(std::string(65537,' '));
    for(int n=0;n<3000;++n){auto raw=corpus[rng()%corpus.size()];const auto changes=rng()%9;for(unsigned k=0;k<changes;++k){if(raw.empty())break;auto index=rng()%raw.size();if(rng()%2)raw[index]=static_cast<char>(rng()%256);else raw.erase(index,1);}try{auto b=Parse(raw,{});Check(b.items.size()<=256&&b.vertices<=4096,"fuzz accepted within caps");}catch(const Refusal&){} }
    auto line=Point();line["kind"]="polyline";line["points"]={{0,0,0},{2048,0,0}};line["dash"]={.5,.5};auto b=BatchOf(json::array({line}));auto raw=b.dump();raw.append(65536-raw.size(),' ');
    Costs parse,project;size_t visible=0;auto c=Cam();
    for(int n=0;n<256;++n){auto start=Now();auto parsed=Parse(raw,{});parse.Add((Now()-start)*1000);Check(parsed.vertices==4096,"benchmark expansion cap");start=Now();XY a{},z{};for(int v=0;v<16384;v+=2)visible+=ProjectSegment(c,{double(v%100)-50,10,0},{double(v%100)-49,10,1},a,z)?1:0;project.Add((Now()-start)*1000);}
    std::printf("CANVAS BUDGET parse_64KiB_4096=%s projection_cull_16384=%s visible=%zu fuzz=3000\n",parse.State().dump().c_str(),project.State().dump().c_str(),visible);
}
}
int CanvasUnitTests()
{
    checks=failures=0;
    const char* stage = "fixtures";
    try {
        Fixtures(); stage="parser"; Parser(); stage="lifecycle"; Lifecycle(); stage="rates/caps"; RatesAndCaps(); stage="clear rates/cap order"; ClearRatesAndCapOrder(); stage="key persistence"; KeyPersistence(); stage="anchors/projection"; AnchorsAndProjection(); stage="capture/fade"; CaptureAndFade(); stage="observer pacing"; ObserverPacing(); stage="furniture/persistence"; FurnitureAndPersistence(); stage="Lua snapshot"; LuaSnapshots(); stage="fuzz/bench"; FuzzAndBench();
    } catch (const std::exception& e) { ++failures; std::printf("CANVAS EXCEPTION stage=%s %s\n",stage,e.what()); }
    std::printf("CANVAS %d checks, %d failures\n",checks,failures);return failures;
}
