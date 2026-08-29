import { Component, type ErrorInfo, type ReactNode } from 'react'
import { StatusNote } from './ui/StatusNote'
import { Button } from './ui/Button'

interface ErrorBoundaryProps {
  children: ReactNode
  // Shown in the fallback ("{label} ko'rsatishda xatolik...") so the same
  // generic boundary reads as which panel broke, not a bare "Xatolik."
  label: string
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
}

// Generic, reusable crash guard (2026-08-29). Before this the app had ZERO
// error boundaries anywhere: any render-time exception unmounted the whole
// tree above it, leaving a blank white screen with nothing in the UI
// pointing at what broke -- only the browser DevTools console, useless on a
// floor phone with no way to open it. This catches render/lifecycle errors
// in whatever it wraps and shows the real error message + component stack
// in place of the crashed subtree instead.
//
// Deliberately NOT a silent retry/auto-reset: a caught error here means
// real render state was left inconsistent, and guessing at a recovery
// (re-rendering the same crashed subtree automatically) risks showing wrong
// data instead of no data. "Yopish" only clears the boundary's own local
// error state so the fallback can be dismissed -- normal interaction with
// whatever's underneath (e.g. reopening a modal with a different serial)
// then remounts the children fresh, same as any other React unmount/remount.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Pick<ErrorBoundaryState, 'error'> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null })
    console.error(`[ErrorBoundary] ${this.props.label}:`, error, info.componentStack)
  }

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (error) {
      return (
        <div className="space-y-2 rounded-md border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
          <StatusNote tone="problem">
            {this.props.label} ko'rsatishda xatolik yuz berdi: {error.message}
          </StatusNote>
          {componentStack && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-red-700/80 dark:text-red-400/80">
              {componentStack.trim()}
            </pre>
          )}
          <Button variant="secondary" size="md" onClick={() => this.setState({ error: null, componentStack: null })}>
            Yopish
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
