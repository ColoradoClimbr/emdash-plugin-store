import type { PluginAdminExports } from "emdash";
import Settings from "./components/Settings.js";

export const pages: PluginAdminExports["pages"] = { "/settings": Settings };
export const widgets: PluginAdminExports["widgets"] = {};
