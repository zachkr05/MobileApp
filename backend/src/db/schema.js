//schema.js

import {
  pgTable,
  serial,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  primaryKey,
  jsonb,
} from "drizzle-orm/pg-core";

// Users
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  spotifyId: text("spotify_id").unique(),
  appleMusicId: text("apple_music_id").unique(),
  accessToken: text("access_token"), // Add for background tasks
  refreshToken: text("refresh_token"), // Add for background tasks
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Follows
export const follows = pgTable("follows", {
  followerId: uuid("follower_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  followingId: uuid("following_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.followerId, table.followingId] }),
}));

// Tracks
export const tracks = pgTable("tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  artist: text("artist"),
  album: text("album"),
  duration: integer("duration"), // seconds
  source: text("source").notNull(), // 'spotify' or 'apple'
  sourceUrl: text("source_url"),
  spotifyId: text("spotify_id").unique(), // Add Spotify track ID
});

// Recent Playback History (Day 8)
export const recentPlayback = pgTable("recent_playback", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  trackId: uuid("track_id").references(() => tracks.id, { onDelete: "cascade" }),
  playedAt: timestamp("played_at", { withTimezone: true }).notNull(),
  context: jsonb("context"), // Spotify context (playlist, album, etc.)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Artists
export const artists = pgTable("artists", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  spotifyId: text("spotify_id").unique(),
  imageUrl: text("image_url"),
  genres: jsonb("genres"), // Array of genres
  popularity: integer("popularity"),
  followers: integer("followers"),
  sourceUrl: text("source_url"),
});

// Top Artists (Day 9)
export const topArtists = pgTable("top_artists", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  artistId: uuid("artist_id").references(() => artists.id, { onDelete: "cascade" }),
  timeRange: text("time_range").notNull(), // short_term, medium_term, long_term
  rank: integer("rank").notNull(),
  collectedAt: timestamp("collected_at", { withTimezone: true }).defaultNow(),
});

// Top Tracks (Day 9 - Enhanced)
export const topTracks = pgTable("top_tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  trackId: uuid("track_id").references(() => tracks.id, { onDelete: "cascade" }),
  timeRange: text("time_range").notNull(), // short_term, medium_term, long_term
  rank: integer("rank").notNull(),
  collectedAt: timestamp("collected_at", { withTimezone: true }).defaultNow(),
});

// User Listening Statistics
export const listeningStats = pgTable("listening_stats", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  date: timestamp("date", { withTimezone: true }).notNull(),
  totalTracks: integer("total_tracks").default(0),
  totalMinutes: integer("total_minutes").default(0),
  uniqueArtists: integer("unique_artists").default(0),
  topGenres: jsonb("top_genres"), // Array of genres with counts
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Now Playing (Real-time status)
export const nowPlaying = pgTable("now_playing", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  trackId: uuid("track_id").references(() => tracks.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  positionSeconds: integer("position_seconds"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Feed Events
export const feedEvents = pgTable("feed_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), 
  trackId: uuid("track_id").references(() => tracks.id, { onDelete: "set null" }),
  context: jsonb("context"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Comments
export const comments = pgTable("comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  senderId: uuid("sender_id").references(() => users.id, { onDelete: "cascade" }),
  trackId: uuid("track_id").references(() => tracks.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Notifications
export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  recipientId: uuid("recipient_id").references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'new_follower', etc.
  sourceUserId: uuid("source_user_id").references(() => users.id, { onDelete: "cascade" }),
  payload: jsonb("payload"),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Push Tokens
export const pushTokens = pgTable("push_tokens", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceToken: text("device_token").notNull(),
  platform: text("platform").notNull(), // 'ios', 'android', 'web'
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});