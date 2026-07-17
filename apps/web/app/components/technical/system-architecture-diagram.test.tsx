import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SystemArchitectureDiagram } from './system-architecture-diagram';

describe('SystemArchitectureDiagram', () => {
  it('renders service boundaries and the search topology', () => {
    render(<SystemArchitectureDiagram />);

    expect(
      screen.getByRole('figure', { name: /Paillette system architecture/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId('architecture-svg')).toBeInTheDocument();
    expect(screen.getAllByTestId('architecture-boundary')).toHaveLength(5);

    for (const label of [
      'Visitor browser',
      'Remix web Worker',
      'Hono API Worker',
      'Auth + quota',
      'Query router',
      'Jina / Workers AI',
      'Vectorize image + text',
      'Vectorize captions',
      'D1 metadata + usage',
      'RRF + hydration',
      'Artwork assets',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('labels the directional data flow instead of explaining it in prose', () => {
    render(<SystemArchitectureDiagram />);

    for (const label of [
      'HTTPS search',
      'POST /search',
      'validate + reserve',
      'embed query',
      'vector query',
      'metadata query',
      'ranked candidates',
      'ranked JSON',
      'GET artwork asset',
      'image response',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText(/request lifecycle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/routed hybrid/i)).not.toBeInTheDocument();
  });

  it('keeps labels inside nodes and makes every connection hoverable', () => {
    render(<SystemArchitectureDiagram />);

    expect(screen.getByText('Visitor browser')).toHaveAttribute('textLength');

    const connections = screen.getAllByTestId('architecture-connection');
    expect(connections).toHaveLength(10);
    for (const connection of connections) {
      expect(connection).toHaveAttribute('tabindex', '0');
      expect(connection.getAttribute('class')).toContain('group');
      expect(
        connection.querySelector('.architecture-connection-hit')
      ).toBeInTheDocument();
      expect(
        connection.querySelector('.architecture-connection-line')
      ).toBeInTheDocument();
    }
  });

  it('paints connector and boundary labels above every connector path', () => {
    render(<SystemArchitectureDiagram />);

    const connectionLayer = screen.getByTestId('architecture-connection-layer');
    const nodeLayer = screen.getByTestId('architecture-node-layer');
    const connectionLabelLayer = screen.getByTestId(
      'architecture-connection-label-layer'
    );
    const boundaryLabelLayer = screen.getByTestId(
      'architecture-boundary-label-layer'
    );

    expect(
      connectionLayer.compareDocumentPosition(nodeLayer) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      connectionLayer.compareDocumentPosition(connectionLabelLayer) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      connectionLayer.compareDocumentPosition(boundaryLabelLayer) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.getAllByTestId('architecture-connection-label-bg')[0]
    ).toHaveAttribute('fill', '#080a0f');
  });

  it('keeps the arrowhead fixed-size while a connection is highlighted', () => {
    render(<SystemArchitectureDiagram />);

    const marker = screen.getByTestId('architecture-arrow');

    expect(marker).toHaveAttribute('markerUnits', 'userSpaceOnUse');
    expect(marker).toHaveAttribute('markerWidth', '10');
    expect(marker.querySelector('path')).toHaveAttribute(
      'fill',
      'context-stroke'
    );
  });

  it('routes the ranked response naturally into the bottom of the web worker', () => {
    render(<SystemArchitectureDiagram />);

    expect(
      screen
        .getByLabelText('ranked JSON connection')
        .querySelector('.architecture-connection-line')
    ).toHaveAttribute('d', 'M 566 590 C 520 590 490 500 480 380');
  });

  it('highlights the components participating in a hovered connection', () => {
    render(<SystemArchitectureDiagram />);

    fireEvent.mouseEnter(screen.getByLabelText('POST /search connection'));

    expect(
      screen.getByTestId('architecture-node-remix-web-worker')
    ).toHaveClass('architecture-node-active');
    expect(screen.getByTestId('architecture-node-auth-quota')).toHaveClass(
      'architecture-node-active'
    );
  });

  it('highlights connected paths when a component is hovered', () => {
    render(<SystemArchitectureDiagram />);

    fireEvent.mouseEnter(screen.getByTestId('architecture-node-query-router'));

    expect(screen.getByLabelText('embed query connection')).toHaveClass(
      'architecture-connection-active'
    );
    expect(screen.getByLabelText('metadata query connection')).toHaveClass(
      'architecture-connection-active'
    );
  });

  it('shows the two-way browser and R2 asset exchange', () => {
    render(<SystemArchitectureDiagram />);

    expect(screen.queryByText('load images')).not.toBeInTheDocument();

    fireEvent.mouseEnter(
      screen.getByTestId('architecture-node-artwork-assets')
    );

    expect(screen.getByLabelText('GET artwork asset connection')).toHaveClass(
      'architecture-connection-active'
    );
    expect(screen.getByLabelText('image response connection')).toHaveClass(
      'architecture-connection-active'
    );
  });
});
