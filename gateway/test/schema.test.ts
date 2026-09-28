import {test,expect} from "bun:test";
import plugin from "../src/plugin.ts";
import manifest from "../openclaw.plugin.json";
test("packaged manifest and runtime config schemas stay identical",()=>{
  expect(manifest.configSchema).toEqual(plugin.configSchema);
});
