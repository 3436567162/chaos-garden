import { Component, type ErrorInfo, type ReactNode, useEffect } from 'react'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import { BarChart3, Github, Settings2 } from 'lucide-react'
import DashboardPage from './pages/DashboardPage'
import ContributorDetailPage from './pages/ContributorDetailPage'
import SettingsPage from './pages/SettingsPage'
import { Button, Card } from './components/ui'
import { greet } from './lib/tauri'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('ContributorRank render error', error, info) }
  render() { if (this.state.error) return <main className="flex min-h-screen items-center justify-center p-6"><Card className="max-w-md p-6"><h1 className="text-lg font-semibold">页面遇到问题</h1><p className="mt-2 text-sm text-muted-foreground">{this.state.error.message}</p><Button className="mt-5" onClick={() => location.reload()}>重新加载</Button></Card></main>; return this.props.children }
}

export default function App() { useEffect(() => { void greet('ContributorRank') }, []); return <ErrorBoundary><BrowserRouter><div className="min-h-screen bg-background"><header className="border-b border-border"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6"><NavLink to="/" className="flex items-center gap-2 font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><BarChart3 size={18} /></span>ContributorRank</NavLink><nav className="flex items-center gap-1"><NavLink to="/" className={({ isActive }) => `rounded-md px-3 py-2 text-sm ${isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}><Github size={15} className="mr-2 inline" />排行榜</NavLink><NavLink to="/settings" className={({ isActive }) => `rounded-md px-3 py-2 text-sm ${isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}><Settings2 size={15} className="mr-2 inline" />设置</NavLink></nav></div></header><Routes><Route path="/" element={<DashboardPage />} /><Route path="/contributors/:login" element={<ContributorDetailPage />} /><Route path="/settings" element={<SettingsPage />} /></Routes></div></BrowserRouter></ErrorBoundary> }
