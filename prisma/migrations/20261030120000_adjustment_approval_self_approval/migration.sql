-- Internal controls (audit BIZ-02, BIZ-03). Additive only: safe on a live database.

-- Manual stock adjustments above the hotel's adjustmentApprovalValue now wait for approval (BIZ-03).
ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'MANUAL_ADJUSTMENT';

-- Segregation of duties (BIZ-02): the creator of a purchase order, budget or recipe version may approve it only
-- when the hotel allows it (small hotels with one manager). Existing hotels start with the stricter rule.
ALTER TABLE "Hotel" ADD COLUMN "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false;
