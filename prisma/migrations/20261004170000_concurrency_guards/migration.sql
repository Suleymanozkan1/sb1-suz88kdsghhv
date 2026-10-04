-- One buffet session per outlet, meal and date, enforced in the database (spec 295).
-- CreateIndex
CREATE UNIQUE INDEX "BuffetSession_hotelId_departmentId_type_serviceDate_key" ON "BuffetSession"("hotelId", "departmentId", "type", "serviceDate");

