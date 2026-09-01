import { create } from 'zustand'
import { Plant, User } from '../types'

interface GardenState {
  user: User | null
  plants: Plant[]
  selectedPlantId: string | null
  setUser: (user: User | null) => void
  setPlants: (plants: Plant[]) => void
  addPlant: (plant: Plant) => void
  updatePlant: (id: string, updates: Partial<Plant>) => void
  removePlant: (id: string) => void
  selectPlant: (id: string | null) => void
}

export const useGardenStore = create<GardenState>((set) => ({
  user: null,
  plants: [],
  selectedPlantId: null,
  
  setUser: (user) => set({ user }),
  setPlants: (plants) => set({ plants }),
  
  addPlant: (plant) => set((state) => ({
    plants: [...state.plants, plant],
  })),
  
  updatePlant: (id, updates) => set((state) => ({
    plants: state.plants.map((p) => p.id === id ? { ...p, ...updates } : p),
  })),
  
  removePlant: (id) => set((state) => ({
    plants: state.plants.filter((p) => p.id !== id),
  })),
  
  selectPlant: (id) => set({ selectedPlantId: id }),
}))
