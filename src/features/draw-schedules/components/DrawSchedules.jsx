import { Box, Typography } from "@mui/material";
import ResponsiveCreateButton from "../../../components/common/ResponsiveCreateButton";

export default function DrawSchedules() {
  return (
    <Box sx={{ minHeight: "100%", bgcolor: "background.default" }}>
      <Box
        sx={{
          px: { xs: 2.5, md: 4 },
          py: 3,
          bgcolor: "background.paper",
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          alignItems: { xs: "flex-start", sm: "center" },
          justifyContent: "space-between",
          gap: 2,
          flexDirection: { xs: "column", sm: "row" },
        }}
      >
        <Box>
          <Typography variant="h5" fontWeight={700} color="text.primary">
            Draw Schedules
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Every builder can keep its own funding milestones, invoice timing,
            release requirements, and required attachments.
          </Typography>
        </Box>

        <ResponsiveCreateButton
          label="New builder schedule"
          mobileLabel="New schedule"
          onClick={() => {
            console.log("New builder schedule");
          }}
        />
      </Box>
    </Box>
  );
}
