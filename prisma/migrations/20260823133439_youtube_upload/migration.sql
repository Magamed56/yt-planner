-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "privacyStatus" TEXT NOT NULL DEFAULT 'unlisted',
ADD COLUMN     "videoFilePath" TEXT,
ADD COLUMN     "youtubeVideoId" TEXT;

-- CreateTable
CREATE TABLE "GoogleAuthToken" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "channelTitle" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAuthToken_pkey" PRIMARY KEY ("id")
);
