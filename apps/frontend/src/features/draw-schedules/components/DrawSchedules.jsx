import { useState } from 'react'
import {
  Avatar,
  Box,
  Button,
  Card,
  Collapse,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'

const builderSchedules = [
  {
    id: 'kb-home',
    initials: 'KH',
    name: 'KB Home',
    avatar: { background: '#EEF6FF', color: '#2C62A1' },
    milestones: [
      {
        name: 'Frame / opening',
        description: 'Verified lot milestone',
        percentage: 25,
      },
      {
        name: 'Install',
        description: 'Verified lot milestone',
        percentage: 50,
      },
      {
        name: 'Final / punch',
        description: 'Release + punch confirmation',
        percentage: 25,
      },
    ],
  },
  {
    id: 'tri-pointe',
    initials: 'TP',
    name: 'Tri Pointe',
    avatar: { background: '#FFF5DF', color: '#9A6B16' },
    milestones: [
      {
        name: 'Material release',
        description: 'Verified lot milestone',
        percentage: 20,
      },
      {
        name: 'Door install',
        description: 'Verified lot milestone',
        percentage: 35,
      },
      {
        name: 'Hardware',
        description: 'Verified lot milestone',
        percentage: 25,
      },
      {
        name: 'Final',
        description: 'Release + punch confirmation',
        percentage: 20,
      },
    ],
  },
  {
    id: 'pulte',
    initials: 'P',
    name: 'Pulte',
    avatar: { background: '#F3EEFF', color: '#6846A5' },
    milestones: [
      {
        name: 'Material',
        description: 'Verified lot milestone',
        percentage: 25,
      },
      {
        name: 'Install',
        description: 'Verified lot milestone',
        percentage: 50,
      },
      {
        name: 'Final',
        description: 'Release + punch confirmation',
        percentage: 25,
      },
    ],
  },
]

function MilestoneRow({ index, milestone }) {
  return (
    <Stack
      direction="row"
      spacing={1.25}
      sx={{
        minHeight: 52,
        py: 0.75,
        alignItems: 'center',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Avatar
        sx={{
          width: 20,
          height: 20,
          bgcolor: '#EDF5EF',
          color: '#357259',
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        {index + 1}
      </Avatar>

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          noWrap
          sx={{
            color: 'text.primary',
            fontSize: 11.5,
            fontWeight: 650,
            lineHeight: 1.35,
          }}
        >
          {milestone.name}
        </Typography>
        <Typography
          noWrap
          sx={{ color: 'text.secondary', fontSize: 9.5, lineHeight: 1.5 }}
        >
          {milestone.description}
        </Typography>
      </Box>

      <Typography
        sx={{
          color: '#246147',
          fontSize: 11.5,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {milestone.percentage}%
      </Typography>
    </Stack>
  )
}

function BuilderScheduleCard({ schedule }) {
  const [expanded, setExpanded] = useState(true)
  const contentId = `${schedule.id}-schedule-milestones`

  return (
    <Card
      variant="outlined"
      sx={{
        width: '100%',
        borderColor: '#C9DCCF',
        borderRadius: 1.5,
        bgcolor: 'background.paper',
        boxShadow: '0 4px 14px rgba(33, 76, 55, 0.045)',
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ minHeight: 59, px: 1.5, alignItems: 'center' }}
      >
        <Avatar
          variant="rounded"
          sx={{
            width: 30,
            height: 30,
            bgcolor: schedule.avatar.background,
            color: schedule.avatar.color,
            fontSize: 11,
            fontWeight: 800,
            borderRadius: 1.1,
          }}
        >
          {schedule.initials}
        </Avatar>

        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            noWrap
            sx={{ color: 'text.primary', fontSize: 13.5, fontWeight: 700 }}
          >
            {schedule.name}
          </Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 9.5 }}>
            {schedule.milestones.length} draw milestones
          </Typography>
        </Box>

        <IconButton
          size="small"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${schedule.name} schedule`}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
          sx={{ color: 'text.secondary', mr: -0.75 }}
        >
          <KeyboardArrowDownRoundedIcon
            sx={{
              fontSize: 17,
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 180ms ease',
            }}
          />
        </IconButton>
      </Stack>

      <Collapse in={expanded} timeout="auto">
        <Box id={contentId} sx={{ px: 1.5 }}>
          {schedule.milestones.map((milestone, index) => (
            <MilestoneRow
              key={`${schedule.id}-${milestone.name}`}
              index={index}
              milestone={milestone}
            />
          ))}

          <Button
            variant="text"
            size="small"
            onClick={() => {
              console.log(`Edit ${schedule.name} schedule`)
            }}
            sx={{
              minWidth: 0,
              minHeight: 38,
              px: 0.25,
              py: 0.75,
              color: '#2E6A50',
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1.5,
              textTransform: 'none',
              '&:hover': { bgcolor: 'transparent', color: '#174A37' },
            }}
          >
            Edit schedule&nbsp;→
          </Button>
        </Box>
      </Collapse>
    </Card>
  )
}

export default function DrawSchedules() {
  return (
    <Box
      sx={{
        minHeight: '100%',
        px: { xs: 2, sm: 3 },
        pt: 2,
        pb: 3,
        bgcolor: 'background.paper',
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{
          alignItems: { xs: 'stretch', sm: 'flex-start' },
          justifyContent: 'space-between',
        }}
      >
        <Box>
          <Typography
            sx={{
              color: 'text.secondary',
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: '0.14em',
              lineHeight: 1.5,
              textTransform: 'uppercase',
            }}
          >
            Builder-specific rules
          </Typography>
          <Typography
            component="h1"
            sx={{
              mt: 0.55,
              color: 'text.primary',
              fontSize: 19,
              fontWeight: 750,
              lineHeight: 1.25,
            }}
          >
            Draw schedules
          </Typography>
        </Box>

        <ResponsiveCreateButton
          label="New Builder Schedule"
          mobileLabel="New Schedule"
          onClick={() => {
            console.log('New builder schedule')
          }}
        />
      </Stack>

      <Typography
        sx={{
          mt: { xs: 2, sm: 2.7 },
          color: 'text.secondary',
          fontSize: 12.5,
          lineHeight: 1.5,
        }}
      >
        Every builder can keep its own funding milestones, invoice timing,
        release requirements, and required attachments.
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            md: 'repeat(3, minmax(0, 1fr))',
          },
          alignItems: 'start',
          gap: 1.5,
        }}
      >
        {builderSchedules.map((schedule) => (
          <BuilderScheduleCard key={schedule.id} schedule={schedule} />
        ))}
      </Box>
    </Box>
  )
}
