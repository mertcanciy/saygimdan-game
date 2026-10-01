const youtubeId = process.env.NEXT_PUBLIC_YOUTUBE_ID ?? "4goQBlcdVUk";

/** The song: played from its official YouTube video in a visible embed (the site hosts no audio). */
export const MUSIC = {
  title: "Saygımdan",
  artist: "Bengü",
  youtubeId,
  youtubeUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
};
