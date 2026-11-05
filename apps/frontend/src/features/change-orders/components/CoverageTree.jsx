import { useState } from 'react'
import { Box, Checkbox, IconButton, Typography } from '@mui/material'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'

import { nodeSelectionState, toggleNode } from '../utils/coverage.js'

function TreeNode({ node, depth, selected, onChange, forceOpen, open, onToggleOpen }) {
  const state = nodeSelectionState(node, selected)
  const hasChildren = node.children.length > 0
  const isOpen = forceOpen || open.has(node.id)

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', pl: depth * 2.5 }}>
        {hasChildren ? (
          <IconButton
            size="small"
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.label}`}
            aria-expanded={isOpen}
            onClick={() => onToggleOpen(node.id)}
          >
            {isOpen ? <ExpandMoreRoundedIcon fontSize="small" /> : <ChevronRightRoundedIcon fontSize="small" />}
          </IconButton>
        ) : (
          <Box sx={{ width: 30, flexShrink: 0 }} />
        )}
        <Checkbox
          size="small"
          checked={state === 'all'}
          indeterminate={state === 'some'}
          disabled={node.leaves.length === 0}
          onChange={() => onChange(toggleNode(node, selected))}
          slotProps={{ input: { 'aria-label': node.label } }}
        />
        <Typography variant="body2" sx={{ fontWeight: depth === 0 ? 600 : 400 }}>
          {node.label}
        </Typography>
      </Box>
      {hasChildren && isOpen && node.children.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          selected={selected}
          onChange={onChange}
          forceOpen={forceOpen}
          open={open}
          onToggleOpen={onToggleOpen}
        />
      ))}
    </>
  )
}

/**
 * Tick boxes for the nodes of a coverage tree. `selected` is a Set of leaf keys
 * and `onChange` gets the next Set. While a search is active every branch is
 * open, so the matches are not hidden.
 */
export default function CoverageTree({ nodes, selected, onChange, searching }) {
  const [open, setOpen] = useState(() => new Set(nodes.map((node) => node.id)))

  const toggleOpen = (id) => setOpen((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  if (nodes.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        {searching ? 'Nothing matches the search.' : 'This Job has no lots yet.'}
      </Typography>
    )
  }

  return (
    <Box role="tree" aria-label="Affected locations">
      {nodes.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          selected={selected}
          onChange={onChange}
          forceOpen={searching}
          open={open}
          onToggleOpen={toggleOpen}
        />
      ))}
    </Box>
  )
}
