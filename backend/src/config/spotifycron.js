/*
import cron from "cron";
import axios from "axios";
import { db } from "./db.js";
import { users, tracks, artists, topTracks, topArtists, recentPlayback } from "../db/schema.js";
import { eq, lt } from "drizzle-orm";

// Helper function to refresh access token
const refreshAccessToken = async (refreshToken) => {
  try {
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }),
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    
    return response.data.access_token;
  } catch (error) {
    console.error("Error refreshing token:", error);
    return null;
  }
};

// Helper function to save artist
const saveArtist = async (artistData) => {
  const [savedArtist] = await db
    .insert(artists)
    .values({
      name: artistData.name,
      spotifyId: artistData.id,
      imageUrl: artistData.images?.[0]?.url || null,
      genres: artistData.genres || [],
      popularity: artistData.popularity || 0,
      followers: artistData.followers?.total || 0,
      sourceUrl: artistData.external_urls?.spotify
    })
    .onConflictDoUpdate({
      target: [artists.spotifyId],
      set: {
        name: artistData.name,
        imageUrl: artistData.images?.[0]?.url || null,
        genres: artistData.genres || [],
        popularity: artistData.popularity || 0,
        followers: artistData.followers?.total || 0
      }
    })
    .returning();
  
  return savedArtist;
};

// Helper function to save track
const saveTrack = async (trackData) => {
  const [savedTrack] = await db
    .insert(tracks)
    .values({
      title: trackData.name,
      artist: trackData.artists.map(a => a.name).join(", "),
      album: trackData.album?.name,
      duration: Math.round(trackData.duration_ms / 1000),
      source: "spotify",
      sourceUrl: trackData.external_urls?.spotify,
      spotifyId: trackData.id
    })
    .onConflictDoUpdate({
      target: [tracks.spotifyId],
      set: {
        title: trackData.name,
        artist: trackData.artists.map(a => a.name).join(", "),
        album: trackData.album?.name
      }
    })
    .returning();
  
  return savedTrack;
};

// Function to collect top tracks for a user
const collectTopTracks = async (user, timeRange) => {
  try {
    let accessToken = user.accessToken;
    
    // Check if token needs refresh
    if (!accessToken || (user.tokenExpiresAt && new Date() > user.tokenExpiresAt)) {
      if (!user.refreshToken) {
        console.log(`No refresh token for user ${user.id}, skipping`);
        return;
      }
      
      accessToken = await refreshAccessToken(user.refreshToken);
      if (!accessToken) {
        console.log(`Failed to refresh token for user ${user.id}, skipping`);
        return;
      }
      
      // Update user with new token
      await db
        .update(users)
        .set({
          accessToken,
          tokenExpiresAt: new Date(Date.now() + 3600 * 1000) // 1 hour from now
        })
        .where(eq(users.id, user.id));
    }
    
    // Fetch top tracks from Spotify
    const response = await axios.get(`https://api.spotify.com/v1/me/top/tracks`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { time_range: timeRange, limit: 50 }
    });
    
    const topTracksData = response.data.items;
    console.log(`Collected ${topTracksData.length} top tracks for user ${user.id} (${timeRange})`);
    
    // Clear old entries for this time range
    await db
      .delete(topTracks)
      .where(eq(topTracks.userId, user.id) && eq(topTracks.timeRange, timeRange));
    
    // Store new top tracks
    for (const [index, track] of topTracksData.entries()) {
      const savedTrack = await saveTrack(track);
      
      await db
        .insert(topTracks)
        .values({
          userId: user.id,
          trackId: savedTrack.id,
          timeRange,
          rank: index + 1,
          collectedAt: new Date()
        });
    }
    
  } catch (error) {
    console.error(`Error collecting top tracks for user ${user.id}:`, error
        