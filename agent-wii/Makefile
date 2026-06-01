#---------------------------------------------------------------------------------
# ConsoleGate Wii agent (cg_gate) — devkitPPC/libogc build.
# Requires the devkitPro toolchain: devkitPPC, libogc, libfat-ogc.
# Build:  make            -> cg_gate.dol  (Priiloader "Install file" target)
# Clean:  make clean
# This Makefile does NOT build on a plain host (no devkitPPC); the portable
# decision logic in ../agent-core is host-tested separately (cd ../agent-core && make test).
#---------------------------------------------------------------------------------
ifeq ($(strip $(DEVKITPPC)),)
$(error "DEVKITPPC is not set. Install devkitPro and run from a devkitPPC shell.")
endif

include $(DEVKITPPC)/wii_rules

TARGET		:=	cg_gate
BUILD		:=	build
SOURCES		:=	platform
INCLUDES	:=	platform ../agent-core/include
# Pull the portable core sources straight into the build.
COREDIR		:=	../agent-core/src

CFLAGS		=	-g -O2 -Wall -Wextra $(MACHDEP) $(INCLUDE) -D__wii__
LDFLAGS		=	-g $(MACHDEP) -Wl,-Map,$(notdir $@).map
LIBS		:=	-lfat -lwiiuse -lbte -logc -lm

ifneq ($(BUILD),$(notdir $(CURDIR)))
export OUTPUT	:=	$(CURDIR)/$(TARGET)
export VPATH	:=	$(foreach dir,$(SOURCES),$(CURDIR)/$(dir)) $(CURDIR)/$(COREDIR)
export DEPSDIR	:=	$(CURDIR)/$(BUILD)
CFILES		:=	$(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.c))) \
				$(notdir $(wildcard $(COREDIR)/*.c))
export OFILES	:=	$(CFILES:.c=.o)
export INCLUDE	:=	$(foreach dir,$(INCLUDES),-I$(CURDIR)/$(dir)) -I$(CURDIR)/$(BUILD)
export LIBPATHS	:=	$(foreach dir,$(LIBDIRS),-L$(dir)/lib)

.PHONY: $(BUILD) clean
$(BUILD):
	@[ -d $@ ] || mkdir -p $@
	@$(MAKE) --no-print-directory -C $(BUILD) -f $(CURDIR)/Makefile

clean:
	@echo clean ...
	@rm -fr $(BUILD) $(TARGET).elf $(TARGET).dol

else
DEPENDS	:=	$(OFILES:.o=.d)
$(OUTPUT).dol: $(OUTPUT).elf
$(OUTPUT).elf: $(OFILES)
-include $(DEPENDS)
endif
