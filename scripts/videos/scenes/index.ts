import type { Scene } from "../studio";
import { inventory } from "./inventory";
import { stockScenes } from "./stock";
import { kitchenScenes } from "./kitchen";
import { controlScenes } from "./control";

export const SCENES: Scene[] = [inventory, ...stockScenes, ...kitchenScenes, ...controlScenes];
