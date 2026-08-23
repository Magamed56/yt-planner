-- CreateEnum
CREATE TYPE "VideoStage" AS ENUM ('IDEA', 'SCRIPT', 'FILMING', 'EDITING', 'READY', 'PUBLISHED', 'REJECTED');

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "niche" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "idea" TEXT,
    "script" TEXT,
    "stage" "VideoStage" NOT NULL DEFAULT 'IDEA',
    "plannedPublishAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "videoUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoStageEvent" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "stage" "VideoStage" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoStageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Channel_name_key" ON "Channel"("name");

-- CreateIndex
CREATE INDEX "Video_channelId_stage_idx" ON "Video"("channelId", "stage");

-- CreateIndex
CREATE INDEX "VideoStageEvent_videoId_idx" ON "VideoStageEvent"("videoId");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoStageEvent" ADD CONSTRAINT "VideoStageEvent_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
