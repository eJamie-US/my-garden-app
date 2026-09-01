-- Create users table (extends auth.users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  garden_title TEXT DEFAULT 'My Garden',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create plants table
CREATE TABLE IF NOT EXISTS plants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  species TEXT,
  photo_url TEXT,
  color TEXT DEFAULT '#22c55e',
  x INTEGER DEFAULT 50,
  y INTEGER DEFAULT 50,
  planted_date TIMESTAMP WITH TIME ZONE,
  water_schedule INTEGER DEFAULT 7,
  last_watered TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_position CHECK (x >= 0 AND x <= 100 AND y >= 0 AND y <= 100)
);

-- Create indexes
CREATE INDEX plants_user_id_idx ON plants(user_id);
CREATE INDEX plants_created_at_idx ON plants(created_at);

-- Create storage bucket for plant photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('plant-photos', 'plant-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE plants ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for users
CREATE POLICY "Users can view their own data" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own data" ON users
  FOR UPDATE USING (auth.uid() = id);

-- Create RLS policies for plants
CREATE POLICY "Users can view their own plants" ON plants
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create plants" ON plants
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own plants" ON plants
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own plants" ON plants
  FOR DELETE USING (auth.uid() = user_id);

-- Storage RLS policy
CREATE POLICY "Users can upload plant photos" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'plant-photos' AND auth.role() = 'authenticated');

CREATE POLICY "Public read access to plant photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'plant-photos');
