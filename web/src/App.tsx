import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, createContext, useContext, useEffect, lazy, Suspense } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { useAuth } from './context/AuthContext'
import { WifiOff } from 'lucide-react'
import type { AuthUser, Notification } from '@shared/types'

// May be used by future routes; harmless to keep while route-audit cleanup continues.
import MainLayout from './components/layout/MainLayout'
import DashboardLayout from './components/layout/DashboardLayout'
import { FeatureGovernanceLoader } from './context/FeatureGovernanceContext'
import { NotFoundPage } from './components/routing/FeatureStatePages'
// RX-02A S1-3: isolated component catalogue renderer (§10.3). Dev-only — the route
// below is gated behind import.meta.env.DEV, so no production surface is added.
import ComponentCatalogue from './pages/dev/ComponentCatalogue'
