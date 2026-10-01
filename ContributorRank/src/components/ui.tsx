import type { ButtonHTMLAttributes, InputHTMLAttributes, PropsWithChildren } from 'react'
import { cn } from '../lib/utils'

export function Button({ className, variant = 'default', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'outline' | 'ghost' }) {
  return <button className={cn('inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50', variant === 'default' && 'bg-primary text-primary-foreground hover:opacity-90', variant === 'outline' && 'border border-border bg-transparent hover:bg-accent', variant === 'ghost' && 'hover:bg-accent', className)} {...props} />
}
export function Card({ className, children }: PropsWithChildren<{ className?: string }>) { return <div className={cn('rounded-xl border border-border bg-card text-card-foreground shadow-sm', className)}>{children}</div> }
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input className={cn('h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-primary', className)} {...props} /> }
export function Label({ children, className }: PropsWithChildren<{ className?: string }>) { return <label className={cn('text-sm font-medium leading-none', className)}>{children}</label> }
export function Badge({ children, className }: PropsWithChildren<{ className?: string }>) { return <span className={cn('inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground', className)}>{children}</span> }
export function Slider({ value, onChange }: { value: number; onChange: (value: number) => void }) { return <input type="range" min="0" max="2" step="0.1" value={value} onChange={e => onChange(Number(e.target.value))} className="h-2 w-full cursor-pointer accent-primary" /> }
