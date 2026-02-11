-- CreateTable
CREATE TABLE "video_assets" (
    "id" TEXT NOT NULL,
    "gumletAssetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "playbackUrl" TEXT,
    "thumbnailUrl" TEXT,
    "duration" INTEGER,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "originalFilename" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "video_assets_gumletAssetId_key" ON "video_assets"("gumletAssetId");

-- CreateIndex
CREATE INDEX "video_assets_targetType_targetId_idx" ON "video_assets"("targetType", "targetId");
