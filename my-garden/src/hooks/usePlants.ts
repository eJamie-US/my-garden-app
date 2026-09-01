// src/hooks/usePlants.ts

import { create } from 'zustand';
import { Plant } from '../types';
import { plantsService } from '../services/supabase/plants';

interface PlantStore {
  plants: Plant[];
  selectedPlantId: string | null;
  loading: boolean;
  error: string | null;

  // Actions
  fetchPlants: (userId: string) => Promise<void>;
  addPlant: (plant: Omit<Plant, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  /** Rethrows on failure — callers (e.g. dragging a marker) need to know a
   *  save actually failed instead of silently reverting with no explanation. */
  updatePlant: (id: string, updates: Partial<Plant>) => Promise<void>;
  /** Syncs a plant that was already created/updated via plantsService directly
   *  into local state, without writing to the database again. */
  upsertPlantLocal: (plant: Plant) => void;
  deletePlant: (id: string, userId: string) => Promise<void>;
  selectPlant: (id: string | null) => void;
  uploadPhoto: (userId: string, plantId: string, file: File) => Promise<string>;
}

export const usePlants = create<PlantStore>((set, get) => ({
  plants: [],
  selectedPlantId: null,
  loading: false,
  error: null,

  fetchPlants: async (userId: string) => {
    set({ loading: true, error: null });
    try {
      const plants = await plantsService.getPlants(userId);
      set({ plants, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch plants',
        loading: false,
      });
    }
  },

  addPlant: async (plant) => {
    set({ loading: true, error: null });
    try {
      const newPlant = await plantsService.createPlant(plant);
      set((state) => ({
        plants: [newPlant, ...state.plants],
        loading: false,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to add plant',
        loading: false,
      });
    }
  },

  updatePlant: async (id, updates) => {
    set({ loading: true, error: null });
    try {
      const updated = await plantsService.updatePlant(id, updates);
      set((state) => ({
        plants: state.plants.map((p) => (p.id === id ? updated : p)),
        loading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update plant';
      set({ error: message, loading: false });
      throw err instanceof Error ? err : new Error(message);
    }
  },

  upsertPlantLocal: (plant) => {
    set((state) => {
      const exists = state.plants.some((p) => p.id === plant.id);
      return {
        plants: exists
          ? state.plants.map((p) => (p.id === plant.id ? plant : p))
          : [plant, ...state.plants],
      };
    });
  },

  // Rethrows, like updatePlant — the caller (the delete-confirm button)
  // needs to know a delete actually failed instead of quietly closing as
  // if the plant were gone.
  deletePlant: async (id, userId) => {
    set({ loading: true, error: null });
    try {
      await plantsService.deletePlant(id, userId);
      set((state) => ({
        plants: state.plants.filter((p) => p.id !== id),
        selectedPlantId: state.selectedPlantId === id ? null : state.selectedPlantId,
        loading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete plant';
      set({ error: message, loading: false });
      throw err instanceof Error ? err : new Error(message);
    }
  },

  selectPlant: (id) => {
    set({ selectedPlantId: id });
  },

  uploadPhoto: async (userId, plantId, file) => {
    try {
      const url = await plantsService.uploadPlantPhoto(userId, plantId, file);
      return url;
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Photo upload failed');
    }
  },
}));
