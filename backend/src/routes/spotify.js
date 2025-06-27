//spotify.js

import express from "express";
import axios from "axios";
import { db } from "../config/db.js";
import { 
  users, 
  tracks, 
  artists, 
  feedEvents, 
  recentPlayback, 
  topArtists, 
  topTracks,
  listeningStats 
} from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";

const router = express.Router();

// Middleware to validate Spotify access token
const validateToken = async (req, res, next) => {
  const { userId, access_token, refresh_token } = req.body;
  
  if (!userId || !access_token) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  // Store on request object for route handlers
  req.spotifyAuth = {
    userId,
    accessToken: access_token,
    refreshToken: refresh_token
  };
  
  next();
};

// Handle token refresh if needed
const refreshTokenIfNeeded = async (error, refreshToken) => {
  if (error?.response?.status === 401 && refreshToken) {
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
    } catch (refreshError) {
      console.error("Error refreshing token:", refreshError);
      throw new Error("Unable to refresh token");
    }
  }
  throw error;
};

// Helper function to save or get artist
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

// Helper function to save or get track
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

// Get user profile from Spotify
router.post("/profile", validateToken, async (req, res) => {
  const { userId, accessToken, refreshToken } = req.spotifyAuth;
  
  try {
    // Call Spotify API to get user profile
    const response = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    const profileData = response.data;
    
    // Update user in database with tokens for background tasks
    await db.update(users)
      .set({
        displayName: profileData.display_name,
        avatarUrl: profileData.images?.[0]?.url || null,
        spotifyId: profileData.id,
        accessToken: accessToken,
        refreshToken: refreshToken,
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour from now
        lastActiveAt: new Date()
      })
      .where(eq(users.id, userId));
    
    res.status(200).json({ success: true, profile: profileData });
  } catch (error) {
    try {
      // Try refreshing token if expired
      if (error?.response?.status === 401 && refreshToken) {
        const newToken = await refreshTokenIfNeeded(error, refreshToken);
        
        // Retry with new token
        const response = await axios.get('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${newToken}` }
        });
        
        const profileData = response.data;
        
        // Update user
        await db.update(users)
          .set({
            displayName: profileData.display_name,
            avatarUrl: profileData.images?.[0]?.url || null,
            spotifyId: profileData.id,
            accessToken: newToken,
            refreshToken: refreshToken,
            tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
            lastActiveAt: new Date()
          })
          .where(eq(users.id, userId));
        
        return res.status(200).json({ 
          success: true, 
          profile: profileData,
          new_token: newToken 
        });
      }
    } catch (refreshError) {
      console.error("Error getting profile after refresh:", refreshError);
    }
    
    console.error("Error getting user profile:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// Get user's top tracks
router.post("/top-tracks", validateToken, async (req, res) => {
  const { userId, accessToken, refreshToken } = req.spotifyAuth;
  const { time_range = "medium_term", limit = 20 } = req.query;
  
  try {
    // Call Spotify API to get top tracks
    const response = await axios.get(`https://api.spotify.com/v1/me/top/tracks`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { time_range, limit }
    });
    
    const topTracksData = response.data.items;
    
    // Store tracks in database
    const savedTracks = [];
    
    for (const [index, track] of topTracksData.entries()) {
      // Save track
      const savedTrack = await saveTrack(track);
      savedTracks.push(savedTrack);
      
      // Save top track entry
      await db
        .insert(topTracks)
        .values({
          userId,
          trackId: savedTrack.id,
          timeRange: time_range,
          rank: index + 1,
          collectedAt: new Date()
        });
      
      // Create feed event for user's top track
      await db
        .insert(feedEvents)
        .values({
          userId,
          eventType: "top_track",
          trackId: savedTrack.id,
          context: { rank: index + 1, timeRange: time_range }
        });
    }
    
    res.status(200).json({ success: true, tracks: savedTracks });
  } catch (error) {
    try {
      // Try refreshing token if expired
      if (error?.response?.status === 401 && refreshToken) {
        const newToken = await refreshTokenIfNeeded(error, refreshToken);
        
        // Retry with new token
        const response = await axios.get(`https://api.spotify.com/v1/me/top/tracks`, {
          headers: { Authorization: `Bearer ${newToken}` },
          params: { time_range, limit }
        });
        
        // Processing logic would be duplicated here in a real implementation
        // Simplified for brevity
        
        return res.status(200).json({ 
          success: true, 
          tracks: response.data.items,
          new_token: newToken 
        });
      }
    } catch (refreshError) {
      console.error("Error getting top tracks after refresh:", refreshError);
    }
    
    console.error("Error getting top tracks:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch top tracks" });
  }
});

// DAY 8: Enhanced Recently Played Endpoint
router.post("/recently-played", validateToken, async (req, res) => {
  const { userId, accessToken, refreshToken } = req.spotifyAuth;
  const { limit = 20, after, before } = req.query;
  
  try {
    // Build params for Spotify API
    const params = { limit };
    if (after) params.after = after;
    if (before) params.before = before;
    
    // Call Spotify API to get recently played tracks
    const response = await axios.get(`https://api.spotify.com/v1/me/player/recently-played`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params
    });
    
    const recentTracks = response.data.items;
    
    // Store tracks and playback history in database
    const savedPlayback = [];
    
    for (const item of recentTracks) {
      const track = item.track;
      
      // Save track
      const savedTrack = await saveTrack(track);
      
      // Save recent playback entry with timestamp
      const [playbackEntry] = await db
        .insert(recentPlayback)
        .values({
          userId,
          trackId: savedTrack.id,
          playedAt: new Date(item.played_at),
          context: {
            context_type: item.context?.type,
            context_uri: item.context?.uri,
            context_name: item.context?.external_urls?.spotify
          }
        })
        .onConflictDoNothing() // Avoid duplicates
        .returning();
      
      if (playbackEntry) {
        savedPlayback.push({
          ...playbackEntry,
          track: savedTrack
        });
        
        // Create feed event for recently played track
        await db
          .insert(feedEvents)
          .values({
            userId,
            eventType: "recently_played",
            trackId: savedTrack.id,
            context: { played_at: item.played_at }
          });
      }
    }
    
    // Update listening statistics
    await updateListeningStats(userId, recentTracks);
    
    res.status(200).json({ success: true, playback: savedPlayback });
  } catch (error) {
    try {
      // Try refreshing token if expired
      if (error?.response?.status === 401 && refreshToken) {
        const newToken = await refreshTokenIfNeeded(error, refreshToken);
        
        // Retry with new token
        const response = await axios.get(`https://api.spotify.com/v1/me/player/recently-played`, {
          headers: { Authorization: `Bearer ${newToken}` },
          params
        });
        
        return res.status(200).json({ 
          success: true, 
          tracks: response.data.items.map(item => item.track),
          new_token: newToken 
        });
      }
    } catch (refreshError) {
      console.error("Error getting recently played after refresh:", refreshError);
    }
    
    console.error("Error getting recently played:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch recently played tracks" });
  }
});

// DAY 9: Top Artists Endpoint
router.post("/top-artists", validateToken, async (req, res) => {
  const { userId, accessToken, refreshToken } = req.spotifyAuth;
  const { time_range = "medium_term", limit = 20 } = req.query;
  
  try {
    // Call Spotify API to get top artists
    const response = await axios.get(`https://api.spotify.com/v1/me/top/artists`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { time_range, limit }
    });
    
    const topArtistsData = response.data.items;
    
    // Store artists in database
    const savedArtists = [];
    
    for (const [index, artist] of topArtistsData.entries()) {
      // Save artist
      const savedArtist = await saveArtist(artist);
      savedArtists.push(savedArtist);
      
      // Save top artist entry
      await db
        .insert(topArtists)
        .values({
          userId,
          artistId: savedArtist.id,
          timeRange: time_range,
          rank: index + 1,
          collectedAt: new Date()
        });
      
      // Create feed event for user's top artist
      await db
        .insert(feedEvents)
        .values({
          userId,
          eventType: "top_artist",
          trackId: null, // No track for artist events
          context: { 
            artistId: savedArtist.id,
            artistName: artist.name,
            rank: index + 1, 
            timeRange: time_range 
          }
        });
    }
    
    res.status(200).json({ success: true, artists: savedArtists });
  } catch (error) {
    try {
      // Try refreshing token if expired
      if (error?.response?.status === 401 && refreshToken) {
        const newToken = await refreshTokenIfNeeded(error, refreshToken);
        
        // Retry with new token
        const response = await axios.get(`https://api.spotify.com/v1/me/top/artists`, {
          headers: { Authorization: `Bearer ${newToken}` },
          params: { time_range, limit }
        });
        
        return res.status(200).json({ 
          success: true, 
          artists: response.data.items,
          new_token: newToken 
        });
      }
    } catch (refreshError) {
      console.error("Error getting top artists after refresh:", refreshError);
    }
    
    console.error("Error getting top artists:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch top artists" });
  }
});

// Helper function to update listening statistics
const updateListeningStats = async (userId, tracks) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get existing stats for today
    const [existingStats] = await db
      .select()
      .from(listeningStats)
      .where(and(
        eq(listeningStats.userId, userId),
        eq(listeningStats.date, today)
      ));
    
    const totalTracks = tracks.length;
    const totalMinutes = tracks.reduce((sum, item) => sum + Math.round(item.track.duration_ms / 1000 / 60), 0);
    const uniqueArtists = new Set(tracks.map(item => item.track.artists[0]?.name)).size;
    
    // Extract genres (would need artist data for this)
    const topGenres = []; // Simplified for now
    
    if (existingStats) {
      // Update existing stats
      await db
        .update(listeningStats)
        .set({
          totalTracks: existingStats.totalTracks + totalTracks,
          totalMinutes: existingStats.totalMinutes + totalMinutes,
          uniqueArtists: Math.max(existingStats.uniqueArtists, uniqueArtists),
          updatedAt: new Date()
        })
        .where(eq(listeningStats.id, existingStats.id));
    } else {
      // Create new stats entry
      await db
        .insert(listeningStats)
        .values({
          userId,
          date: today,
          totalTracks,
          totalMinutes,
          uniqueArtists,
          topGenres
        });
    }
  } catch (error) {
    console.error("Error updating listening stats:", error);
  }
};

export default router;