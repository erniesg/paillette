import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './card';

describe('Card Components', () => {
  describe('Card', () => {
    it('renders card with content', () => {
      render(<Card>Card Content</Card>);
      expect(screen.getByText(/card content/i)).toBeInTheDocument();
    });

    it('applies correct styling classes', () => {
      const { container } = render(<Card>Content</Card>);
      const card = container.firstChild as HTMLElement;
      expect(card).toHaveClass('rounded-xl', 'border');
    });

    it('accepts custom className', () => {
      const { container } = render(<Card className="custom-class">Content</Card>);
      const card = container.firstChild as HTMLElement;
      expect(card).toHaveClass('custom-class');
    });
  });

  describe('CardHeader', () => {
    it('renders header content', () => {
      render(<CardHeader>Header Content</CardHeader>);
      expect(screen.getByText(/header content/i)).toBeInTheDocument();
    });

    it('applies correct styling classes', () => {
      const { container } = render(<CardHeader>Content</CardHeader>);
      const header = container.firstChild as HTMLElement;
      expect(header).toHaveClass('flex', 'flex-col', 'space-y-1.5', 'p-6');
    });
  });

  describe('CardTitle', () => {
    it('renders title text', () => {
      render(<CardTitle>Card Title</CardTitle>);
      expect(screen.getByText(/card title/i)).toBeInTheDocument();
    });

    it('applies correct styling classes', () => {
      const { container } = render(<CardTitle>Title</CardTitle>);
      const title = container.firstChild as HTMLElement;
      expect(title).toHaveClass('font-semibold', 'leading-none', 'tracking-tight');
    });
  });

  describe('CardDescription', () => {
    it('renders description text', () => {
      render(<CardDescription>Description text</CardDescription>);
      expect(screen.getByText(/description text/i)).toBeInTheDocument();
    });

    it('applies correct styling classes', () => {
      const { container } = render(<CardDescription>Desc</CardDescription>);
      const desc = container.firstChild as HTMLElement;
      expect(desc).toHaveClass('text-sm');
    });
  });

  describe('CardContent', () => {
    it('renders content', () => {
      render(<CardContent>Content</CardContent>);
      expect(screen.getByText(/content/i)).toBeInTheDocument();
    });

    it('applies correct styling classes', () => {
      const { container } = render(<CardContent>Content</CardContent>);
      const content = container.firstChild as HTMLElement;
      expect(content).toHaveClass('p-6', 'pt-0');
    });
  });

  describe('Full Card Component', () => {
    it('renders complete card with all parts', () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Test Title</CardTitle>
            <CardDescription>Test Description</CardDescription>
          </CardHeader>
          <CardContent>Test Content</CardContent>
        </Card>
      );

      expect(screen.getByText(/test title/i)).toBeInTheDocument();
      expect(screen.getByText(/test description/i)).toBeInTheDocument();
      expect(screen.getByText(/test content/i)).toBeInTheDocument();
    });
  });
});
