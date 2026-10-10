-- CreateTable
CREATE TABLE "OrderEmailTemplate" (
    "hotelId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "OrderEmailTemplate_pkey" PRIMARY KEY ("hotelId")
);

-- AddForeignKey
ALTER TABLE "OrderEmailTemplate" ADD CONSTRAINT "OrderEmailTemplate_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
