-- A sale line id is unique per outlet (department), not per hotel: an importer scoped to one department can no
-- longer claim the ids (incl. the integration's keys) of another department's sales.
DROP INDEX "SaleLine_hotelId_externalId_key";
CREATE UNIQUE INDEX "SaleLine_hotelId_departmentId_externalId_key" ON "SaleLine"("hotelId", "departmentId", "externalId");
