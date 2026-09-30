import { Updater } from "electrobun/main";
import type { NativeUpdater } from "./update-service";

// Electrobun 2.0.2 application-side API (its Updater is unchanged from 2.0.1). Production does not instantiate this
// port until its feed, signatures and installed A→B trial satisfy the gate.
export const electrobunUpdater: NativeUpdater = {
  checkForUpdate: () => Updater.checkForUpdate(),
  downloadUpdate: () => Updater.downloadUpdate(),
  updateInfo: () => Updater.updateInfo(),
  applyUpdate: () => Updater.applyUpdate(),
};
