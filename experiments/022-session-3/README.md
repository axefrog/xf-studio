# Session 3: Glitter board, blink and creator checks

**Status:** prepared, not staged. This is the in-game session after [session 2](../020-session-2/README.md). The coordinator stages the Glitter board once session 2's results are in, replacing session 2's pair in the **XF Eye Artistry** mod of the test MO2 profile (`XF Studio diagnostic 2026-09-25`). Nothing here has been seen in game.

One session, in four parts. Part A needs the staged board; parts B to D work with any XF Eye Artistry build, or none. Record the game version, the upscaler and mode, and whether ray or path tracing is on. Make a new manual save first (this profile shares the save folder) and load it again afterwards.

## Part A: Glitter board

The [experiment 021 test card](../021-glitter-board/README.md#test-card), steps 1 to 9: six Glitter presets testing flake size, nested mips against plain ones, shine, flake tilt and an optional glowing accent. Photo mode with film grain, chromatic aberration and depth of field off.

## Part B: blink

From [facial animation](../../knowledge/facial-animation.md#in-game-test-asks). In the creator, or photo mode with the eyes closed:

1. **Closure.** Frontal close-ups of a fully closed blink on eye shapes 01, 10 and 12, and the shape using morph `h011`. Is any eye visible between the lids?
2. **Lashes.** In the same shots, do the upper lashes lie along the closed lid line?
3. **Makeup on closed lids.** With an XF Eye Artistry look covering the upper lid on eye shape 12, close the eyes. Does bare skin show between the crease and the lashes?

## Part C: creator and piercings

From [CC file chain](../../knowledge/cc-file-chain.md) and [head CC rendering](../../knowledge/head-cc-rendering.md):

4. **Makeup Off on the legacy build.** On the reference character, set each legacy XF Eye Artistry layer row, and the lipstick and blush rows, to Off at a mirror. Does anything of them remain drawn?
5. **Linked hairstyles.** Pick hairstyle 5 without face cyberware, then a face cyberware that swaps the hairstyle row to its cyberware variant. Is it still the same hair?
6. **Creator rows.** On the body page of a new game, note the rows in order, and whether any unlabelled row appears.
7. **Piercings and the heart eye** (if not done in session 2): piercing style 9 in black, style 1 in silver and gold, and eye colour 24. Does gold show grey, or black plastic lose its colour?

## Part D: expression console checks (optional)

Only if expressions are going ahead (see the [expressions brief](../../research/backlog/expressions-and-idles-brief.md#runtime-questions-for-one-batched-session)). These use the CET console. Everything here only reads, except step 10, which changes V's photo-mode expression until you pick another one or leave photo mode. What each call is based on is in the [evidence note](../../research/animation/expressions-evidence.md#session-3-probes).

**Before you start.** CET must be installed and enabled for the test profile. It is in the game folder (1.37.1), and Codeware, Photo Mode Pose Selector, AMM and the Mega Pack are enabled in the profile. Don't install or enable anything for this part. Open the CET overlay with the key you picked when CET was first set up (often `~`); the **Console** window is part of the overlay. The console takes one line at a time: copy a whole line, paste it into the input box at the bottom, press Enter. The lines are forgotten when the game restarts.

8. **Setup**, in normal play before photo mode. Paste these three lines in order. They print `[XF] line 1 of 3 loaded`, `[XF] line 2 of 3 loaded; observer registered: true` and `[XF] line 3 of 3 loaded`. Line 1 names the files we expect to see, line 2 teaches the console to find photo-mode V, line 3 adds the checks.

   ```lua
   XF = {pm = nil, V = TweakDBID.new("Character.Player_Puppet_Photomode"), K = { ["7508524370571000797"] = "male player facial setup (h0_001_ma_c__player)", ["10415616482342000482"] = "female basehead facial setup (h0_000_pwa_c__basehead)", ["8781612653389801630"] = "demo_vicky facial setup (head .ent placeholder)", ["5692985458712302925"] = "photomode_female_facial.anims", ["15713926467694944364"] = "photomode__v_female__facial.anims", ["13506775912504498162"] = "photomode_male_facial.anims", ["10289231064258128219"] = "photomode__v__facial.anims", ["18388182181626074466"] = "ui_female_face.anims", ["5467289578558517710"] = "ui_male_face.anims", ["1349464784567840761"] = "generic_facial_additives.anims (blinks)", ["13870987152078611154"] = "photo-mode face_rig .app", ["4202529424089658858"] = "gameplay face_rig .app", ["14034739559546167190"] = "EP1 face_rig .app", ["738403064129442492"] = "female photo-mode face_rig .ent", ["16401722103778230458"] = "male photo-mode face_rig .ent", ["6731798080394786357"] = "player_wa_tpp_head.ent", ["8529343484951946551"] = "player_wa_photomode.ent", ["12734933228571637223"] = "player_wa_photomode_ep1.ent", ["11531108300488686453"] = "player_ma_photomode.ent", ["14357642568368009885"] = "player_ma_photomode_ep1.ent"}} for i, h in ipairs({"2170419568231146605", "1036520139246494180", "111899956219093243", "12512900997296166618", "18311356226551423241", "8143814230757681184", "2717118884276777207", "182703928695878678", "16109410056548350533", "5199779266537029727", "6338883381860420456", "1238112097776027121", "4556636069641597954", "17578197876011117091", "14545399369127868940"}) do XF.K[h] = "Mega Pack set " .. i end XF.p = function(s) print("[XF] " .. tostring(s)) end XF.u = function(v) return (string.gsub(tostring(v), "U?LL$", "")) end XF.h = function(x) if x == nil then return "none" end local t = type(x) if t == "number" or t == "cdata" then return XF.u(x) end local ok, v = pcall(function() return x.hash end) if ok and v ~= nil then return XF.u(v) end ok, v = pcall(function() return x.resource.hash end) if ok and v ~= nil then return XF.u(v) end return "unreadable" end XF.n = function(x) local h = XF.h(x) if XF.K[h] then return h .. " = " .. XF.K[h] end return h end XF.s = function(c) local ok, v = pcall(function() return c.value end) if ok and v ~= nil then return tostring(v) end return tostring(c) end XF.p("line 1 of 3 loaded")
   ```

   ```lua
   XF.isV = function(e) local ok, r = pcall(function() return e:GetRecordID() == XF.V end) return ok and r == true end XF.find = function() if XF.pm ~= nil and IsDefined(XF.pm) then return XF.pm, "observer" end local ok, e = pcall(function() return Game.GetScriptableSystemsContainer():Get(CName.new("PhotoModePoseSelectorTargetBridge.PMPSPhotoModeVTargetSystem")):GetPhotoModeV() end) if ok and e ~= nil and XF.isV(e) then return e, "Photo Mode Pose Selector" end ok, e = pcall(function() return GetMod("AppearanceMenuMod").Tools.photoModePuppet end) if ok and e ~= nil and XF.isV(e) then return e, "AMM" end return nil, "nothing" end XF.head = function(pm) return Game.GetTransactionSystem():GetItemInSlot(pm, TweakDBID.new("AttachmentSlots.TppHead")) end if not XF_OBSERVING then XF_OBSERVING = pcall(function() ObserveAfter("PhotoModePlayerEntityComponent", "SetupInventory", function(self) local e = self.fakePuppet if e ~= nil and XF.isV(e) then XF.pm = e end end) end) end XF.p("line 2 of 3 loaded; observer registered: " .. tostring(XF_OBSERVING))
   ```

   ```lua
   XF.sets = function(tag, a, brief) if a == nil then XF.p(tag .. " animations: none") return end local g = a.gameplay or {} local c = a.cinematics or {} XF.p(tag .. " gameplay sets " .. #g .. ", cinematic sets " .. #c) if brief then return end for i, s in ipairs(g) do XF.p(tag .. "   g" .. i .. " priority " .. tostring(s.priority) .. " set " .. XF.n(s.animSet)) end for i, s in ipairs(c) do XF.p(tag .. "   c" .. i .. " priority " .. tostring(s.priority) .. " set " .. XF.n(s.animSet)) end end XF.comps = function(label, ent, full) local ok, list = pcall(function() return ent:GetComponents() end) if not ok or list == nil then XF.p(label .. ": GetComponents failed (is Codeware enabled?) " .. tostring(list)) return end XF.p(label .. " has " .. #list .. " components") for _, c in ipairs(list) do local cls = XF.s(c:GetClassName()) local anim = cls == "entAnimatedComponent" or cls == "entAnimationSetupExtensionComponent" if full or anim then local nm = XF.s(c:GetName()) local ok2, from = pcall(function() return " | from " .. XF.n(c.appearancePath) .. " appearance " .. XF.s(c.appearanceName) end) XF.p(label .. " " .. cls .. " '" .. nm .. "'" .. (ok2 and from or "")) if cls == "entAnimatedComponent" then XF.p(label .. "   " .. nm .. " facialSetup " .. XF.n(c.facialSetup)) end if anim then XF.sets(label .. "   " .. nm, c.animations, not full) end end end end XF.r1 = function() local pm, src = XF.find() if pm == nil then XF.p("R1: photo-mode V not found. Leave photo mode, enter it again, then run XF.r1() again.") return end XF.p("R1 on CET " .. tostring(GetVersion()) .. "; photo-mode V found via " .. src .. "; record " .. TDBID.ToStringDEBUG(pm:GetRecordID())) pcall(function() XF.p("puppet template " .. XF.n(pm:GetTemplatePath())) end) XF.comps("puppet", pm, false) local hd = XF.head(pm) if hd == nil then XF.p("R1: nothing in AttachmentSlots.TppHead") return end pcall(function() XF.p("head item " .. TDBID.ToStringDEBUG(ItemID.GetTDBID(hd:GetItemID())) .. "; template " .. XF.n(hd:GetTemplatePath())) end) XF.comps("head", hd, true) XF.p("R1 done") end XF.graph = function() local pm = XF.find() local hd = pm and XF.head(pm) local c = hd and hd:FindComponentByName(CName.new("face_rig")) if c == nil then XF.p("graph: no face_rig on the head item") return end XF.p("face_rig graph: " .. tostring(GameDump(c.graph))) XF.p("face_rig rig: " .. tostring(GameDump(c.rig))) end XF.face = function(n, onHead) local pm, src = XF.find() if pm == nil then XF.p("R2: photo-mode V not found") return end local t = pm if onHead then t = XF.head(pm) end if t == nil then XF.p("R2: no head item") return end local f = NewObject("handle:AnimFeature_PhotomodeFacial") f.facialPoseIndex = n AnimationControllerComponent.ApplyFeature(t, CName.new("PhotomodeFacial"), f, 0) AnimationControllerComponent.PushEvent(t, CName.new("updateFacialPose")) XF.p("R2: index " .. tostring(n) .. " sent to the " .. (onHead and "head item" or "puppet") .. " (V found via " .. src .. ")") end XF.p("line 3 of 3 loaded")
   ```

9. **R1: which facial setup the photo-mode face uses.** Enter photo mode with V, open the overlay and run:

   ```lua
   XF.r1()
   ```

   It prints a few dozen `[XF]` lines ending in `[XF] R1 done`. Screenshot the console, scrolling up so every line is caught. If it says V was not found, leave photo mode, enter it again and rerun `XF.r1()`.

10. **R2: whether an expression's number picks its row in the expression table.** Still in photo mode with V: expression **Neutral**, camera close on the face, look-at off. For each command, run it, wait two seconds, screenshot the face:

    ```lua
    XF.face(9)
    ```

    Expected: Surprised. If the face doesn't change, run `XF.face(9, true)` instead, and add `, true` to the next two as well.

    ```lua
    XF.face(60)
    ```

    Expected: the Mega Pack's "Static: Sleeping".

    ```lua
    XF.face(217)
    ```

    One past the last row: note whatever happens, including nothing.

    Then close the overlay and pick **Static: Sleeping** from the photo-mode expression menu, and screenshot it. It is 57th in the menu (position 56, counting from 0) but has number 60, and row 56 of the table is "Static: Skeptical": a sleeping face means the menu sends the number, a sceptical one means it sends the position. To undo step 10, pick any expression in the menu or leave photo mode.

11. **Optional, last thing in the session:** `XF.graph()` prints the face rig's animation graph and rig. It uses a debug print that has not been tried on these fields, so run it only after everything else is saved.

Send back the screenshots and CET's `scripting.log` (`PATH_TO_GAME\bin\x64\plugins\cyber_engine_tweaks\scripting.log`, or the same path under MO2's `overwrite` folder), taken after quitting the game: CET finishes writing that file only when the game exits.
