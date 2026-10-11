/**
 * Opera night-audit statistics of the business day.
 * Selectors: selectors/opera.json
 *   login                    as for Micros
 *   statistics.steps         navigation to the statistics / manager report of the day
 *   statistics.ready         optional element to wait for
 *   statistics.fields.{availableRooms, occupiedRooms, guests, roomRevenue?, outOfOrder?, outOfService?}   single values
 *                            (out of order = OOO, out of service = OOS: both are not sellable that night)
 *   statistics.rooms         optional: list of occupied rooms ({steps?, row, roomNumber, noData?}); null = not read
 */
import type { Occupancy } from "../../contract";
import { Screen } from "../../browser/screen";
import type { OperaSelectors } from "../../browser/selectors";
import { login } from "../login";
import { num, optNum, screenOptions, type ScreenContext } from "../context";

export async function operaLogin(ctx: ScreenContext<OperaSelectors>, credentials: { username: string; password: string }): Promise<void> {
  await login(ctx.page, "Opera", ctx.selectors.login, credentials, screenOptions(ctx));
}

export async function readOccupancy(ctx: ScreenContext<OperaSelectors>): Promise<Occupancy> {
  const s = ctx.selectors;
  const fmt = s.numberFormat ?? "auto";
  const screen = new Screen(ctx.page, "statistics", s.statistics as unknown as Record<string, unknown>, screenOptions(ctx));
  await screen.runSteps("steps");
  if (screen.sel("ready", true)) await screen.need("ready");
  const occ: Occupancy = {
    availableRooms: num(await screen.text("fields.availableRooms"), "available rooms", fmt),
    occupiedRooms: num(await screen.text("fields.occupiedRooms"), "occupied rooms", fmt),
    guests: num(await screen.text("fields.guests"), "guests", fmt),
    roomRevenue: optNum(await screen.optionalText("fields.roomRevenue"), "room revenue", fmt),
    outOfOrder: optNum(await screen.optionalText("fields.outOfOrder"), "out of order", fmt),
    outOfService: optNum(await screen.optionalText("fields.outOfService"), "out of service", fmt),
  };
  if (s.statistics.rooms) {
    await screen.runSteps("rooms.steps");
    if ((await screen.waitAny(["rooms.row", "rooms.noData"])) === "rooms.noData") occ.occupiedRoomNumbers = [];
    else {
      const rows = await screen.readRows("rooms.row", { roomNumber: "rooms.roomNumber" }, ["roomNumber"]);
      occ.occupiedRoomNumbers = [...new Set(rows.map((r) => r.roomNumber ?? "").filter(Boolean))];
    }
  }
  return occ;
}
