import type { ButtonHTMLAttributes } from 'react';
import { type ButtonSize, type ButtonVariant, buttonClasses } from './button-styles';

export function Button({
  variant,
  size,
  className,
  type = 'button',
  ...props
}: { variant?: ButtonVariant; size?: ButtonSize } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...props} />;
}
