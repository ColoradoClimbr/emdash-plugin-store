import type { PluginAdminExports } from "emdash";
import Settings from "./components/Settings.js";
import Orders from "./components/Orders.js";

export const pages: PluginAdminExports["pages"] = { "/settings": Settings, "/orders": Orders };
export const widgets: PluginAdminExports["widgets"] = {};
